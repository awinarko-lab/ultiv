import { Type, type Static } from "typebox";

/**
 * One room: a contextual conversation between bots (a pair, or a group).
 * Each participant experiences the room through their OWN conversation
 * (keyed `roomConversationKey`), so identity sections and memory scope stay
 * per-entity — a room is never a shared transcript with a shared persona.
 * Rooms are not sessions: they never appear in session lists; the app
 * surfaces them through `/api/rooms`.
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

/** One participant's view of a room: their conversation id and transcript. */
export const RoomSeatSchema = Type.Object({
  profileId: Type.String(),
  conversationId: Type.Union([Type.String(), Type.Null()]),
});

export type RoomSeat = Static<typeof RoomSeatSchema>;
