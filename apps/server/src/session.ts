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
import {
  EffortSchema,
  ModelIdSchema,
  Session,
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
import { touchSession } from "./sessions.ts";
import type { Principal } from "./main.ts";

type SessionCells = {
  transcript: Cell<TranscriptEntry[]>;
  phase: Cell<Phase>;
  lastError: Cell<string | null>;
  pending: Cell<PendingApproval>;
  usage: Cell<UsageSummary>;
  model: Cell<string | null>;
  effort: Cell<ThinkingLevel | null>;
};

/** First hydrated revision of a conversation's structural view. */
async function viewSnapshot(conversation: Conversation): Promise<ConversationView> {
  const view = await conversation.viewState(BACKGROUND_CONTEXT);
  if (view.value !== undefined) return view.value;
  return new Promise<ConversationView>((resolve) => {
    const unsubscribe = view.subscribe((value) => {
      unsubscribe();
      resolve(value);
    });
  });
}

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
    (input, _principal, self) => {
      const conversation = Effect.runPromise(mind.converse.ensure(input.id));
      const cells: SessionCells = {
        transcript: self.state("transcript", TranscriptSchema, {
          init: async () => {
            const view = await viewSnapshot(await conversation);
            return projectTranscript(view.entries, liveOf(view), false);
          },
        }),
        phase: self.state("phase", PhaseSchema, "idle"),
        lastError: self.state("lastError", SessionErrorSchema, null),
        pending: self.state("pending", PendingApprovalSchema, null),
        usage: self.state("usage", UsageSummarySchema, {
          init: async () => {
            const view = await viewSnapshot(await conversation);
            return (
              usageOf(view.entries) ?? {
                input: 0,
                output: 0,
                cacheRead: 0,
                reasoning: null,
                totalTokens: 0,
              }
            );
          },
        }),
        model: self.state("model", ModelIdSchema, null),
        effort: self.state("effort", EffortSchema, null),
      };
      // Live replay: every committed publication of the durable transcript re-projects the
      // cell, whoever wrote it (this object's turns, tasks, tools, future code).
      const conversationId = conversation.then((chat) => String(chat.id));
      let lastView: ConversationView | undefined;
      self.task(async (ctx) => {
        const chat = await conversation;
        const view = await chat.viewState(BACKGROUND_CONTEXT);
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
        // Reflect the conversation's durable model/effort selection.
        const selection = await Effect.runPromise(mind.converse.agentOf(chat));
        safeChange(cells.model, ctx, () => selection.model);
        safeChange(cells.effort, ctx, () => selection.effort as ThinkingLevel | null);
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
        configure: async ({ model, effort }, ctx) => {
          const chat = await conversation;
          await Effect.runPromise(mind.converse.configure(chat, { model, effort }));
          safeChange(cells.model, ctx, () => model);
          safeChange(cells.effort, ctx, () => effort);
          return { ok: true };
        },
        approve: async ({ callId, approved }, ctx) => {
          const id = await conversationId;
          mind.approvals.decide(id, callId, approved);
          safeChange(cells.pending, ctx, () => mind.approvals.pendingFor(id)[0] ?? null);
          return { ok: true };
        },
        input: async ({ text }, ctx) => {
          if (cells.phase.value === "working") {
            throw invalid("busy", "the agent is already working");
          }
          cells.phase.change(ctx, () => "working");
          cells.lastError.change(ctx, () => null);
          try {
            // Admit first, in the method: an entry becomes visible through the
            // durable transcript projection only once it is committed to storage.
            const chat = await conversation;
            const submission = await Effect.runPromise(mind.converse.submit(chat, text));
            settle(host, mind, chat, submission, input.id, cells, text);
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
  sessionId: string,
  cells: SessionCells,
  text: string,
): void {
  void host.root(async (ctx) => {
    try {
      const result = await Effect.runPromise(mind.converse.settle(conversation, submission));
      if (result.text.trim() !== "") {
        await touchSession(mind, sessionId, { at: Date.now(), titleSeed: text });
      }
      safeChange(cells.phase, ctx, () => "idle");
    } catch (error) {
      console.error("agent turn failed:", error);
      safeChange(cells.lastError, ctx, () => String(error));
      safeChange(cells.phase, ctx, () => "error");
    }
  });
}
