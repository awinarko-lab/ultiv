import { hostNamed, method, remote } from "@earendil-works/chord";
import { Type, type Static } from "typebox";

export const SessionInfoSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  createdAt: Type.Number(),
  lastMessageAt: Type.Number(),
});

export type SessionInfo = Static<typeof SessionInfoSchema>;

export const SessionListSchema = Type.Array(SessionInfoSchema);

/** Durable registry of chat sessions; each id opens a `Chat` object with replayable history. */
export const Sessions = remote("ultiv.sessions", {
  version: 1,
  input: Type.Object({}),
  host: hostNamed("server"),
  variants: {
    default: {
      state: {
        sessions: SessionListSchema,
      },
      methods: {
        create: method(
          Type.Object({ title: Type.Union([Type.String(), Type.Null()]) }),
          Type.Object({ id: Type.String() }),
        ),
      },
    },
  },
});
