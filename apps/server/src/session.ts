import type { Cell, Host } from "@earendil-works/chord";
import { invalid, isChordError } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  AssistantEntry,
  defineDocFamily,
  type Conversation,
  type ConversationId,
  type ConversationView,
  type EntryRecord,
  type Harness,
  type Submission,
} from "@earendil-works/pi-durable";
import {
  Session,
  SessionErrorSchema,
  PendingApprovalSchema,
  PhaseSchema,
  TranscriptEntrySchema,
  TranscriptSchema,
  type PendingApproval,
  type Phase,
  type TranscriptEntry,
} from "@ultiv/contracts";
import { decideApproval, pendingFor } from "./approvals.ts";
import { defaultAgent } from "./ai/agent.ts";
import { touchSession } from "./sessions.ts";
import type { Principal } from "./main.ts";

type SessionCells = {
  transcript: Cell<TranscriptEntry[]>;
  phase: Cell<Phase>;
  lastError: Cell<string | null>;
  pending: Cell<PendingApproval>;
};

/** Durable session-id -> conversation-id mapping (session doc family; SQLite-backed). */
const SessionMapDoc = defineDocFamily<
  { conversationId: ConversationId },
  { conversationId: ConversationId }
>({
  kind: "ultiv.session-map",
  version: 1,
  scope: "session",
  family: true,
  initial: (seed) => ({ conversationId: seed.conversationId }),
  checkpointWhen: () => true,
});

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => String((b as { text?: string }).text ?? "")).join("");
  }
  return JSON.stringify(content);
}

/** Durable transcript entries -> rendered session steps (input/output/thinking/tool). */
function projectTranscript(entries: readonly EntryRecord[], working: boolean): TranscriptEntry[] {
  const results = new Map<
    string,
    { content: unknown; isError: boolean; durationMs: number | null }
  >();
  for (const entry of entries) {
    for (const message of (entry.model ?? []) as readonly unknown[]) {
      const record = message as {
        role?: string;
        toolCallId?: unknown;
        content?: unknown;
        isError?: boolean;
        durationMs?: unknown;
      };
      if (record.role !== "toolResult" || record.toolCallId === undefined) continue;
      results.set(String(record.toolCallId), {
        content: record.content,
        isError: record.isError === true,
        durationMs: typeof record.durationMs === "number" ? record.durationMs : null,
      });
    }
  }
  const out: TranscriptEntry[] = [];
  for (const entry of entries) {
    for (const message of (entry.model ?? []) as readonly unknown[]) {
      const record = message as {
        role?: string;
        content?: unknown;
        timestamp?: unknown;
      };
      const at = typeof record.timestamp === "number" ? record.timestamp : Date.now();
      const blocks = Array.isArray(record.content)
        ? (record.content as readonly unknown[])
        : [{ type: "text", text: textOf(record.content) }];
      let blockIndex = 0;
      for (const block of blocks) {
        const id = entry.id * 100 + blockIndex++;
        if (record.role === "user") {
          const text = String((block as { text?: unknown }).text ?? "").trim();
          if (text !== "") out.push({ id, kind: "input", at, text });
          break;
        }
        const kind = (block as { type?: string }).type;
        if (kind === "thinking") {
          const text = String((block as { thinking?: unknown }).thinking ?? "").trim();
          if (text !== "") out.push({ id, kind: "thinking", at, text });
        } else if (kind === "toolCall") {
          const callId = String((block as { id?: unknown }).id ?? id);
          const result = results.get(callId);
          out.push({
            id,
            kind: "tool",
            at,
            step: {
              callId,
              name: String((block as { name?: unknown }).name ?? "tool"),
              status: result === undefined ? "running" : result.isError ? "error" : "done",
              input: (block as { arguments?: unknown }).arguments ?? null,
              output: result === undefined ? null : textOf(result.content).trim(),
              durationMs: result === undefined ? null : result.durationMs,
            },
          });
        } else if (kind === "text") {
          const text = String((block as { text?: unknown }).text ?? "").trim();
          if (text !== "") {
            out.push({ id, kind: "output", at, text, streaming: false });
          }
        }
      }
    }
  }
  // The newest agent text is streaming while the agent works.
  if (working) {
    for (let index = out.length - 1; index >= 0; index--) {
      const entry = out[index] as TranscriptEntry;
      if (entry.kind === "output") {
        out[index] = { ...entry, streaming: true };
        break;
      }
      if (entry.kind !== "thinking") break;
    }
  }
  return out;
}

/** Resolve the durable conversation behind one session id, creating and mapping it on first use. */
export async function ensureConversation(
  harness: Harness,
  sessionId: string,
): Promise<Conversation> {
  const known = await harness.snapshot(SessionMapDoc, sessionId, BACKGROUND_CONTEXT);
  if (known) {
    const existing = await harness.conversation(known.conversationId, BACKGROUND_CONTEXT);
    if (existing) return existing;
  }
  const created = await harness.createConversation(
    { ownership: { kind: "ownerless" }, agent: defaultAgent() },
    BACKGROUND_CONTEXT,
  );
  await harness.commit(async (tx) => {
    const draft = await tx.doc(SessionMapDoc, sessionId, { conversationId: created.id });
    draft.conversationId = created.id;
  }, BACKGROUND_CONTEXT);
  return created;
}

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

/** Registers per-session Session objects: state is a live projection of the durable transcript. */
export function serveSession(host: Host<Principal>, harness: Harness): void {
  host.serve(
    Session,
    (input, _principal, self) => {
      const conversation = ensureConversation(harness, input.id);
      const cells: SessionCells = {
        transcript: self.state("transcript", TranscriptSchema, {
          init: async () =>
            projectTranscript((await viewSnapshot(await conversation)).entries, false),
        }),
        phase: self.state("phase", PhaseSchema, "idle"),
        lastError: self.state("lastError", SessionErrorSchema, null),
        pending: self.state("pending", PendingApprovalSchema, null),
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
            projectTranscript(value.entries, cells.phase.value === "working"),
          );
        };
        view.subscribe((value) => apply(value));
        if (view.value !== undefined) apply(view.value);
        // Surface tool calls waiting for the user's approve/deny decision.
        while (!ctx.signal.aborted) {
          const [waiting] = pendingFor(await conversationId);
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
          projectTranscript(view.entries, phase === "working"),
        );
      });
      return {
        variant: "default",
        transcript: cells.transcript,
        phase: cells.phase,
        lastError: cells.lastError,
        pending: cells.pending,
        approve: async ({ callId, approved }, ctx) => {
          const id = await conversationId;
          decideApproval(id, callId, approved);
          safeChange(cells.pending, ctx, () => pendingFor(id)[0] ?? null);
          return { ok: true };
        },
        input: async ({ text }, ctx) => {
          if (cells.phase.value === "working") {
            throw invalid("busy", "the agent is already working");
          }
          cells.phase.change(ctx, () => "working");
          cells.lastError.change(ctx, () => null);
          try {
            // Admit first: an entry becomes visible through the durable
            // transcript projection only once it is committed to storage.
            const conversation2 = await conversation;
            const submission = await conversation2.submit(
              { type: "input", content: text },
              BACKGROUND_CONTEXT,
            );
            settle(host, harness, conversation2, submission, input.id, cells, text);
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
  harness: Harness,
  conversation: Conversation,
  submission: Submission,
  sessionId: string,
  cells: SessionCells,
  text: string,
): void {
  void host.root(async (ctx) => {
    try {
      const settled = await submission.wait(BACKGROUND_CONTEXT);
      if (settled.status !== "done" || settled.type !== "input") {
        throw new Error(`agent unanswered: ${JSON.stringify(settled).slice(0, 200)}`);
      }
      const stored = await conversation.commit(
        (tx) => tx.entry(AssistantEntry, settled.answer),
        BACKGROUND_CONTEXT,
      );
      const message = stored?.model?.[0] as { content?: unknown } | undefined;
      if (textOf(message?.content).trim() !== "") {
        await touchSession(harness, sessionId, { at: Date.now(), titleSeed: text });
      }
      safeChange(cells.phase, ctx, () => "idle");
    } catch (error) {
      console.error("agent turn failed:", error);
      safeChange(cells.lastError, ctx, () => String(error));
      safeChange(cells.phase, ctx, () => "error");
    }
  });
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
