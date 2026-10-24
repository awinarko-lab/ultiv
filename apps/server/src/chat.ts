import type { Cell, Host } from "@earendil-works/chord";
import { invalid } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { AssistantEntry, type Harness } from "@earendil-works/pi-durable";
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

type ConversationRoot = Awaited<ReturnType<Harness["root"]>>;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => String((b as { text?: string }).text ?? "")).join("");
  }
  return JSON.stringify(content);
}

/** Registers the per-conversation Chat objects: state replicated to clients, replies through the harness. */
export function serveChat(host: Host<Principal>, harness: Harness): void {
  host.serve(Chat, (_input, _principal, self) => {
    const cells: ChatCells = {
      messages: self.state("messages", ChatMessagesSchema, []),
      turn: self.state("turn", ChatTurnSchema, "idle"),
      lastError: self.state("lastError", ChatErrorSchema, null),
    };
    // One durable conversation per object; created on first send, reused for every turn after.
    let root: Promise<ConversationRoot> | undefined;
    const conversationRoot = () => {
      root ??= harness.root(BACKGROUND_CONTEXT, { agent: kenariAgent() });
      return root;
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
        reply(host, harness, conversationRoot(), cells, text);
      },
    };
  });
}

async function runTurn(
  harness: Harness,
  root: Promise<ConversationRoot>,
  cells: ChatCells,
  text: string,
  ctx: Parameters<Parameters<Host<Principal>["root"]>[0]>[0],
): Promise<void> {
  const conversation = await root;
  const submission = await conversation.submit(
    { type: "input", content: text },
    BACKGROUND_CONTEXT,
  );
  const settled = await submission.wait(BACKGROUND_CONTEXT);
  if (settled.status !== "done" || settled.type !== "input") {
    throw new Error(`kenari unanswered: ${JSON.stringify(settled).slice(0, 200)}`);
  }
  const stored = await conversation.commit(
    (tx) => tx.entry(AssistantEntry, settled.answer),
    BACKGROUND_CONTEXT,
  );
  const message = stored?.model?.[0] as { content?: unknown } | undefined;
  const reply = textOf(message?.content).trim();
  cells.messages.change(ctx, (list) => [
    ...list,
    { role: "assistant", text: reply, at: Date.now() },
  ]);
  cells.turn.change(ctx, () => "idle");
}

/** Fire-and-forget: the method returns at once; the harness turn lands in state when it settles. */
function reply(
  host: Host<Principal>,
  harness: Harness,
  root: Promise<ConversationRoot>,
  cells: ChatCells,
  text: string,
): void {
  void host.root(async (ctx) => {
    try {
      await runTurn(harness, root, cells, text, ctx);
    } catch (error) {
      console.error("chat turn failed:", error);
      cells.lastError.change(ctx, () => String(error));
      cells.turn.change(ctx, () => "error");
    }
  });
}
