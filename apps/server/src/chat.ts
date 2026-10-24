import type { Cell, Host } from "@earendil-works/chord";
import { invalid } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  AssistantEntry,
  defineDocFamily,
  type Conversation,
  type ConversationId,
  type Harness,
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

/** Transcript messages (pi-ai `Message`) -> replicated chat messages; tool and empty entries drop out. */
function toChatMessages(messages: readonly unknown[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const message of messages) {
    const role = (message as { role?: string }).role;
    if (role !== "user" && role !== "assistant") continue;
    const text = textOf((message as { content?: unknown }).content).trim();
    if (text === "") continue;
    const at = (message as { timestamp?: unknown }).timestamp;
    out.push({ role, text, at: typeof at === "number" ? at : Date.now() });
  }
  return out;
}

/** Resolve the durable conversation behind one chat id, creating and mapping it on first use. */
async function resolveConversation(harness: Harness, chatId: string): Promise<Conversation> {
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

async function historyOf(conversation: Conversation): Promise<ChatMessage[]> {
  const view = await conversation.context(BACKGROUND_CONTEXT);
  return toChatMessages(view.messages);
}

/** Registers the per-conversation Chat objects: replicated state, replies through the harness. */
export function serveChat(host: Host<Principal>, harness: Harness): void {
  host.serve(Chat, (input, _principal, self) => {
    const conversation = resolveConversation(harness, input.id);
    const cells: ChatCells = {
      messages: self.state("messages", ChatMessagesSchema, {
        init: async () => historyOf(await conversation),
      }),
      turn: self.state("turn", ChatTurnSchema, "idle"),
      lastError: self.state("lastError", ChatErrorSchema, null),
    };
    return {
      variant: "default",
      messages: cells.messages,
      turn: cells.turn,
      lastError: cells.lastError,
      send: ({ text }, ctx) => {
        if (cells.turn.value === "thinking") {
          throw invalid("busy", "a reply is already in flight");
        }
        cells.messages.change(ctx, (list) => [...list, { role: "user", text, at: Date.now() }]);
        cells.turn.change(ctx, () => "thinking");
        cells.lastError.change(ctx, () => null);
        reply(host, conversation, cells, text);
      },
    };
  });
}

async function runTurn(
  conversation: Promise<Conversation>,
  cells: ChatCells,
  text: string,
  ctx: Parameters<Parameters<Host<Principal>["root"]>[0]>[0],
): Promise<void> {
  const chat = await conversation;
  const submission = await chat.submit({ type: "input", content: text }, BACKGROUND_CONTEXT);
  const settled = await submission.wait(BACKGROUND_CONTEXT);
  if (settled.status !== "done" || settled.type !== "input") {
    throw new Error(`kenari unanswered: ${JSON.stringify(settled).slice(0, 200)}`);
  }
  const stored = await chat.commit(
    (tx) => tx.entry(AssistantEntry, settled.answer),
    BACKGROUND_CONTEXT,
  );
  const message = stored?.model?.[0] as { content?: unknown } | undefined;
  const replyText = textOf(message?.content).trim();
  cells.messages.change(ctx, (list) => [
    ...list,
    { role: "assistant", text: replyText, at: Date.now() },
  ]);
  cells.turn.change(ctx, () => "idle");
}

/** Fire-and-forget: the method returns at once; the harness turn lands in state when it settles. */
function reply(
  host: Host<Principal>,
  conversation: Promise<Conversation>,
  cells: ChatCells,
  text: string,
): void {
  void host.root(async (ctx) => {
    try {
      await runTurn(conversation, cells, text, ctx);
    } catch (error) {
      console.error("chat turn failed:", error);
      cells.lastError.change(ctx, () => String(error));
      cells.turn.change(ctx, () => "error");
    }
  });
}
