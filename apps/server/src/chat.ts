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
  Chat,
  ChatErrorSchema,
  ChatMessagesSchema,
  ChatTurnSchema,
  type ChatMessage,
  type ChatTurn,
} from "@ultiv/contracts";
import { kenariAgent } from "./ai/kenari.ts";
import { touchSession } from "./sessions.ts";
import type { Principal } from "./main.ts";

type ChatCells = {
  messages: Cell<ChatMessage[]>;
  turn: Cell<ChatTurn>;
  lastError: Cell<string | null>;
};

/** Durable chat-id -> conversation-id mapping (session doc family; SQLite-backed). */
const ChatMapDoc = defineDocFamily<
  { conversationId: ConversationId },
  { conversationId: ConversationId }
>({
  kind: "ultiv.chat-map",
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

/** Durable transcript entries -> replicated chat messages; tool and empty entries drop out. */
function toChatMessages(entries: readonly EntryRecord[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const entry of entries) {
    for (const message of (entry.model ?? []) as readonly unknown[]) {
      const role = (message as { role?: string }).role;
      if (role !== "user" && role !== "assistant") continue;
      const text = textOf((message as { content?: unknown }).content).trim();
      if (text === "") continue;
      const at = (message as { timestamp?: unknown }).timestamp;
      out.push({ id: entry.id, role, text, at: typeof at === "number" ? at : Date.now() });
    }
  }
  return out;
}

/** Resolve the durable conversation behind one chat id, creating and mapping it on first use. */
export async function ensureConversation(harness: Harness, chatId: string): Promise<Conversation> {
  const known = await harness.snapshot(ChatMapDoc, chatId, BACKGROUND_CONTEXT);
  if (known) {
    const existing = await harness.conversation(known.conversationId, BACKGROUND_CONTEXT);
    if (existing) return existing;
  }
  const created = await harness.createConversation(
    { ownership: { kind: "ownerless" }, agent: kenariAgent() },
    BACKGROUND_CONTEXT,
  );
  await harness.commit(async (tx) => {
    const draft = await tx.doc(ChatMapDoc, chatId, { conversationId: created.id });
    draft.conversationId = created.id;
  }, BACKGROUND_CONTEXT);
  return created;
}

/** First hydrated revision of a conversation's structural view. */
async function viewSnapshot(chat: Conversation): Promise<ConversationView> {
  const view = await chat.viewState(BACKGROUND_CONTEXT);
  if (view.value !== undefined) return view.value;
  return new Promise<ConversationView>((resolve) => {
    const unsubscribe = view.subscribe((value) => {
      unsubscribe();
      resolve(value);
    });
  });
}

/** Registers per-conversation Chat objects: state is a live projection of the durable transcript. */
export function serveChat(host: Host<Principal>, harness: Harness): void {
  host.serve(
    Chat,
    (input, _principal, self) => {
      const conversation = ensureConversation(harness, input.id);
      const cells: ChatCells = {
        messages: self.state("messages", ChatMessagesSchema, {
          init: async () => toChatMessages((await viewSnapshot(await conversation)).entries),
        }),
        turn: self.state("turn", ChatTurnSchema, "idle"),
        lastError: self.state("lastError", ChatErrorSchema, null),
      };
      // Live replay: every committed publication of the durable transcript re-projects the
      // cell, whoever wrote it (this object's turns, tasks, tools, future code).
      self.task(async (ctx) => {
        const chat = await conversation;
        const view = await chat.viewState(BACKGROUND_CONTEXT);
        const apply = (value: ConversationView) => {
          safeChange(cells.messages, ctx, () => toChatMessages(value.entries));
        };
        view.subscribe((value) => apply(value));
        if (view.value !== undefined) apply(view.value);
        await new Promise<void>((resolve) => {
          ctx.signal.addEventListener("abort", () => resolve());
        });
      });
      return {
        variant: "default",
        messages: cells.messages,
        turn: cells.turn,
        lastError: cells.lastError,
        send: async ({ text }, ctx) => {
          if (cells.turn.value === "thinking") {
            throw invalid("busy", "a reply is already in flight");
          }
          cells.turn.change(ctx, () => "thinking");
          cells.lastError.change(ctx, () => null);
          try {
            // Admit first: a message becomes visible through the durable
            // transcript projection only once it is committed to storage.
            const chat = await conversation;
            const submission = await chat.submit(
              { type: "input", content: text },
              BACKGROUND_CONTEXT,
            );
            settle(host, harness, chat, submission, input.id, cells, text);
          } catch (error) {
            console.error("send failed:", error);
            safeChange(cells.lastError, ctx, () => String(error));
            safeChange(cells.turn, ctx, () => "error");
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
  chatId: string,
  cells: ChatCells,
  text: string,
): void {
  void host.root(async (ctx) => {
    try {
      const settled = await submission.wait(BACKGROUND_CONTEXT);
      if (settled.status !== "done" || settled.type !== "input") {
        throw new Error(`kenari unanswered: ${JSON.stringify(settled).slice(0, 200)}`);
      }
      const stored = await conversation.commit(
        (tx) => tx.entry(AssistantEntry, settled.answer),
        BACKGROUND_CONTEXT,
      );
      const message = stored?.model?.[0] as { content?: unknown } | undefined;
      if (textOf(message?.content).trim() !== "") {
        await touchSession(harness, chatId, { at: Date.now(), titleSeed: text });
      }
      safeChange(cells.turn, ctx, () => "idle");
    } catch (error) {
      console.error("chat turn failed:", error);
      safeChange(cells.lastError, ctx, () => String(error));
      safeChange(cells.turn, ctx, () => "error");
    }
  });
}
