import { hostNamed, method, remote } from "@earendil-works/chord";
import { Type, type Static } from "typebox";

export const ChatMessageSchema = Type.Object({
  /** Durable entry id (positive) or a negative optimistic id until the transcript confirms it. */
  id: Type.Number(),
  role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
  text: Type.String(),
  at: Type.Number(),
});

export type ChatMessage = Static<typeof ChatMessageSchema>;

export const ChatMessagesSchema = Type.Array(ChatMessageSchema);

export const ChatTurnSchema = Type.Union([
  Type.Literal("idle"),
  Type.Literal("thinking"),
  Type.Literal("error"),
]);

export type ChatTurn = Static<typeof ChatTurnSchema>;

export const ChatErrorSchema = Type.Union([Type.String(), Type.Null()]);

export const Chat = remote("ultiv.chat", {
  version: 2,
  input: Type.Object({ id: Type.String() }),
  host: hostNamed("server"),
  variants: {
    default: {
      state: {
        messages: ChatMessagesSchema,
        turn: ChatTurnSchema,
        lastError: ChatErrorSchema,
      },
      methods: {
        send: method(Type.Object({ text: Type.String() })),
      },
    },
  },
});
