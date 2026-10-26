import type { Cell, Host } from "@earendil-works/chord";
import { invalid, isChordError } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type {
  Conversation,
  ConversationView,
  LiveState,
  Submission,
} from "@earendil-works/pi-durable";
import { Effect } from "effect";
import { artifactsDir, readArtifact } from "@ultiv/ext";
import {
  EffortSchema,
  ModelIdSchema,
  Session,
  SessionConversationIdSchema,
  SessionErrorSchema,
  PendingApprovalSchema,
  PhaseSchema,
  TranscriptSchema,
  UsageSummarySchema,
  type PendingApproval,
  type Phase,
  type ThinkingLevel,
  type TranscriptEntry,
  type UsageSummary,
} from "@ultiv/contracts";
import { projectTranscript, usageOf, type MindService } from "@ultiv/mind";
import { ownerOf, type Principal } from "./identity.ts";

type SessionCells = {
  transcript: Cell<TranscriptEntry[]>;
  phase: Cell<Phase>;
  lastError: Cell<string | null>;
  pending: Cell<PendingApproval>;
  usage: Cell<UsageSummary>;
  model: Cell<string | null>;
  effort: Cell<ThinkingLevel | null>;
  conversationId: Cell<string | null>;
};

/** The `pi.live` conversation doc from a structural view, typed. */
function liveOf(view: ConversationView): LiveState | undefined {
  return view.docs["pi.live"] as LiveState | undefined;
}

/** Cell write that survives object disposal: background turns may outlive the last reference. */
function safeChange<T>(
  cell: Cell<T>,
  ctx: Parameters<Cell<T>["change"]>[0],
  fn: Parameters<Cell<T>["change"]>[1],
): void {
  try {
    cell.change(ctx, fn);
  } catch (error) {
    console.warn("cell write skipped:", isChordError(error) ? error.code : error);
  }
}

/** Registers per-session Session objects: state is a live projection of the durable transcript. */
export function serveSession(host: Host<Principal>, mind: MindService): void {
  host.serve(
    Session,
    (input, principal, self) => {
      const owner = ownerOf(principal);
      // The registry row decides the scope (profile, DM pair); unknown ids
      // land under the default profile — pre-profile ids keep their legacy
      // mapping through keyForSession.
      const conversation = mind.profiles
        .keyForSession(owner, input.id)
        .then((key) => Effect.runPromise(mind.converse.ensure(key)));
      // Sync empty starts: the transcript/usage hydration must NOT publish at
      // attach — a publication racing the client's subscribe handshake trips
      // chord's ack window over the wire and desyncs every object on the link
      // (the sessions list included). The task applies hydration after the
      // attach settles, then on every publication as before.
      const cells: SessionCells = {
        transcript: self.state("transcript", TranscriptSchema, []),
        phase: self.state("phase", PhaseSchema, "idle"),
        lastError: self.state("lastError", SessionErrorSchema, null),
        pending: self.state("pending", PendingApprovalSchema, null),
        usage: self.state("usage", UsageSummarySchema, {
          input: 0,
          output: 0,
          cacheRead: 0,
          reasoning: null,
          totalTokens: 0,
        }),
        model: self.state("model", ModelIdSchema, null),
        effort: self.state("effort", EffortSchema, null),
        conversationId: self.state("conversationId", SessionConversationIdSchema, null),
      };
      // Live replay: every committed publication of the durable transcript re-projects the
      // cell, whoever wrote it (this object's turns, tasks, tools, future code).
      const conversationId = conversation.then((chat) => String(chat.id));
      let lastView: ConversationView | undefined;
      self.task(async (ctx) => {
        const chat = await conversation;
        const view = await chat.viewState(BACKGROUND_CONTEXT);
        // Let the client's attach settle before the first hydration publish.
        await new Promise<void>((resolve) => setTimeout(resolve, 1_500));
        const apply = (value: ConversationView) => {
          lastView = value;
          safeChange(cells.transcript, ctx, () =>
            projectTranscript(value.entries, liveOf(value), cells.phase.value === "working"),
          );
          const usage = usageOf(value.entries);
          if (usage !== undefined) safeChange(cells.usage, ctx, () => usage);
        };
        const unsubscribe = view.subscribe((value) => apply(value));
        if (view.value !== undefined) apply(view.value);
        // Reflect the conversation's durable model/effort selection. Both
        // reads may land after a shutdown closed the harness (this object's
        // task outlives the last reference); a failed read is not an error.
        const selection = await Effect.runPromise(mind.converse.agentOf(chat)).catch(
          () => undefined,
        );
        if (selection !== undefined) {
          safeChange(cells.model, ctx, () => selection.model);
          safeChange(cells.effort, ctx, () => selection.effort as ThinkingLevel | null);
        }
        safeChange(cells.conversationId, ctx, () => String(chat.id));
        // Detach on abort, or the attached view outlives the object and hangs
        // graceful shutdown (node --watch restarts wait forever).
        ctx.signal.addEventListener("abort", () => unsubscribe(), { once: true });
        // Surface tool calls waiting for the user's approve/deny decision.
        while (!ctx.signal.aborted) {
          const [waiting] = mind.approvals.pendingFor(await conversationId);
          safeChange(cells.pending, ctx, () => waiting ?? null);
          await new Promise<void>((resolve) => setTimeout(resolve, 250));
        }
      });
      // Phase transitions re-project once more, so the streaming flag
      // clears when the turn ends even if no publication followed.
      self.on("reproject", cells.phase, (phase, ctx) => {
        const view = lastView;
        if (view === undefined) return;
        safeChange(cells.transcript, ctx, () =>
          projectTranscript(view.entries, liveOf(view), phase === "working"),
        );
      });
      return {
        variant: "default",
        transcript: cells.transcript,
        phase: cells.phase,
        lastError: cells.lastError,
        pending: cells.pending,
        usage: cells.usage,
        model: cells.model,
        effort: cells.effort,
        conversationId: cells.conversationId,
        configure: async ({ model, effort }, ctx) => {
          const chat = await conversation;
          await Effect.runPromise(mind.converse.configure(chat, { model, effort }));
          safeChange(cells.model, ctx, () => model);
          safeChange(cells.effort, ctx, () => effort);
          return { ok: true };
        },
        interrupt: async (_input, ctx) => {
          const chat = await conversation;
          await Effect.runPromise(mind.converse.interrupt(chat));
          // Release whatever still waits on the aborted turn — a stopped turn
          // must not leave approval cards hanging (each waiter is denied, the
          // gated tool unwinds with "denied by the user").
          const id = await conversationId;
          for (const request of mind.approvals.pendingFor(id)) {
            mind.approvals.decide(id, request.callId, false);
          }
          safeChange(cells.pending, ctx, () => null);
          safeChange(cells.phase, ctx, () => "idle");
          safeChange(cells.lastError, ctx, () => null);
          return { ok: true };
        },
        approve: async ({ callId, approved, always }, ctx) => {
          const id = await conversationId;
          const waiting = mind.approvals.pendingFor(id).find((r) => r.callId === callId);
          // "Always allow" saves the tool on the profile's autoApprove list;
          // the broker's hook reads policies live, so the next call skips the
          // gate. A failed rule save must not swallow the decision itself.
          if (approved && always === true && waiting !== undefined) {
            const profile = mind.profiles.profileOf(id);
            if (profile !== undefined) {
              try {
                await mind.profiles.allowTool(owner, profile.id, waiting.name);
              } catch (error) {
                console.warn("always-allow rule save failed:", error);
              }
            }
          }
          mind.approvals.decide(id, callId, approved);
          mind.audit.record({
            at: Date.now(),
            kind: "approval",
            conversationId: id,
            profile: mind.profiles.profileOf(id)?.id ?? null,
            callId,
            name: waiting?.name ?? null,
            durationMs: null,
            ok: approved,
            error: null,
          });
          safeChange(cells.pending, ctx, () => mind.approvals.pendingFor(id)[0] ?? null);
          return { ok: true };
        },
        input: async ({ text, attachments }, ctx) => {
          if (cells.phase.value === "working") {
            throw invalid("busy", "the agent is already working");
          }
          cells.phase.change(ctx, () => "working");
          cells.lastError.change(ctx, () => null);
          try {
            // Admit first, in the method: an entry becomes visible through the
            // durable transcript projection only once it is committed to storage.
            const chat = await conversation;
            const content =
              attachments === undefined ? text : await withAttachments(text, attachments);
            const submission = await Effect.runPromise(mind.converse.submit(chat, content));
            settle(host, mind, chat, submission, owner, input.id, cells, text);
          } catch (error) {
            console.error("input failed:", error);
            safeChange(cells.lastError, ctx, () => String(error));
            safeChange(cells.phase, ctx, () => "error");
            throw error;
          }
        },
      };
    },
    // Hold the object (and its replay) briefly after the last reference so a
    // navigation mid-turn does not dispose it out from under the background turn.
    { linger: 60_000 },
  );
}

/** Settles an admitted submission in the background; the transcript projection picks up the turn. */
function settle(
  host: Host<Principal>,
  mind: MindService,
  conversation: Conversation,
  submission: Submission,
  owner: string,
  sessionId: string,
  cells: SessionCells,
  text: string,
): void {
  void host.root(async (ctx) => {
    try {
      const result = await Effect.runPromise(mind.converse.settle(conversation, submission));
      if (result.text.trim() !== "") {
        await mind.profiles.touchSession(owner, sessionId, { at: Date.now(), titleSeed: text });
      }
      safeChange(cells.phase, ctx, () => "idle");
    } catch (error) {
      // A user stop is not an error: the abort surfaces as an unanswered
      // submission and the phase is already idle.
      if (!String(error).includes("abort")) {
        console.error("agent turn failed:", error);
        safeChange(cells.lastError, ctx, () => String(error));
        safeChange(cells.phase, ctx, () => "error");
      } else {
        safeChange(cells.phase, ctx, () => "idle");
      }
    }
  });
}

/** The attachment block an input carries: one reference line per artifact id. */
async function withAttachments(text: string, attachments: readonly string[]): Promise<string> {
  const dir = artifactsDir();
  const lines = attachments.map((id) => {
    const found = readArtifact(dir, id);
    if (found === undefined) return `- artifact ${id}: (unknown)`;
    return `- artifact ${found.info.id} "${found.info.name}" (${found.info.mime}): use artifact_read to open it`;
  });
  return `${text}\n\nAttached artifacts:\n${lines.join("\n")}`;
}
