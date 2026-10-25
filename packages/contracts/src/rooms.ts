import { Type, type Static } from "typebox";

/**
 * One room: a TUNNEL between the sender's thread (main chat, or the session
 * the message was sent from) and the counterpart's main thread. The room
 * record carries routing (participants + topic); the canonical exchange
 * transcript lives in the mailbox entries — the thinking happens at the
 * endpoints, never inside the tunnel. Rooms are not sessions: they never
 * appear in session lists; the app surfaces them through `/api/rooms`.
 */
export const RoomInfoSchema = Type.Object({
  id: Type.String(),
  owner: Type.String(),
  /** The conversation's context ("Q3 report", "onboarding"); empty = general. */
  topic: Type.String(),
  participants: Type.Array(Type.String()),
  createdAt: Type.Number(),
  lastMessageAt: Type.Number(),
});

export type RoomInfo = Static<typeof RoomInfoSchema>;

export const RoomListSchema = Type.Array(RoomInfoSchema);

export type RoomList = Static<typeof RoomListSchema>;
