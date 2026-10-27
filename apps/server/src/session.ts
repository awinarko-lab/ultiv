import type { Host } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationView, LiveState } from "@earendil-works/pi-durable";
import { Type } from "typebox";
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
  QueuedInputSchema,
  TranscriptSchema,
  UsageSummarySchema,
  type ThinkingLevel,
} from "@ultiv/contracts";
import { projectTranscript, stopTurn, usageOf, type MindService } from "@ultiv/mind";
import { ownerOf, type Principal } from "./identity.ts";
import {
  InFlight,
  queuedOf,
  safeChange,
  sameQueue,
  settle,
  stopChatTasks,
  type SessionCells,
} from "./session-turns.ts";

/** The `pi.live` conversation doc from a structural view, typed. */
function liveOf(view: ConversationView): LiveState | undefined {
  return view.docs["pi.live"] as LiveState | undefined;
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
        queued: self.state("queued", Type.Array(QueuedInputSchema), []),
      };
      // Live replay: every committed publication of the durable transcript re-projects the
      // cell, whoever wrote it (this object's turns, tasks, tools, future code).
      const conversationId = conversation.then((chat) => String(chat.id));
      const inFlight = new InFlight();
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
          const queued = queuedOf(value);
          if (!sameQueue(queued, cells.queued.value)) safeChange(cells.queued, ctx, () => queued);
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
        queued: cells.queued,
        withdraw: async ({ id }, ctx) => {
          const chat = await conversation;
          const status = await Effect.runPromise(mind.converse.withdraw(chat, id));
          // Whatever the engine says, the chip goes: a withdrawn message left
          // the inbox, and one already placed is part of the turn now.
          safeChange(cells.queued, ctx, (queued) => queued.filter((item) => item.id !== id));
          return { status };
        },
        configure: async ({ model, effort }, ctx) => {
          const chat = await conversation;
          await Effect.runPromise(mind.converse.configure(chat, { model, effort }));
          safeChange(cells.model, ctx, () => model);
          safeChange(cells.effort, ctx, () => effort);
          return { ok: true };
        },
        interrupt: async (input, ctx) => {
          // Withdraw the queue, abort the turn, deny every waiting approval card.
          await stopTurn(mind.converse, mind.approvals, await conversation);
          const cancelledTasks =
            input.tasks === true ? await stopChatTasks(mind, await conversationId) : 0;
          safeChange(cells.pending, ctx, () => null);
          safeChange(cells.queued, ctx, () => []);
          safeChange(cells.phase, ctx, () => "idle");
          safeChange(cells.lastError, ctx, () => null);
          return { ok: true, cancelledTasks };
        },
        approve: async ({ callId, approved, always, takeover }, ctx) => {
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
          mind.approvals.decide(
            id,
            callId,
            approved,
            // "Take over": the owner does this one themselves — the agent is
            // told not to retry, so the turn carries on without nagging.
            !approved && takeover === true
              ? "the owner is handling this themselves - do not retry; carry on and let them tell you when it is done"
              : undefined,
          );
          mind.audit.record({
            at: Date.now(),
            kind: "approval",
            conversationId: id,
            profile: mind.profiles.profileOf(id)?.id ?? null,
            callId,
            name: waiting?.name ?? null,
            durationMs: null,
            ok: approved,
            error: !approved && takeover === true ? "taken over by the owner" : null,
          });
          safeChange(cells.pending, ctx, () => mind.approvals.pendingFor(id)[0] ?? null);
          return { ok: true };
        },
        input: async ({ text, attachments, whenBusy }, ctx) => {
          // Mid-turn sends are welcome: by default they steer the running turn
          // at its next step; `followUp` waits until the turn finishes.
          inFlight.start();
          cells.phase.change(ctx, () => "working");
          cells.lastError.change(ctx, () => null);
          try {
            // Admit first, in the method: an entry becomes visible through the
            // durable transcript projection only once it is committed to storage.
            const chat = await conversation;
            const content =
              attachments === undefined ? text : await withAttachments(text, attachments);
            const submission = await Effect.runPromise(
              mind.converse.submit(chat, content, whenBusy ?? "steer"),
            );
            const sessionId = input.id;
            settle({
              host,
              mind,
              conversation: chat,
              submission,
              owner,
              sessionId,
              cells,
              inFlight,
              text,
            });
          } catch (error) {
            inFlight.finish();
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
