import { hostNamed, method, remote } from "@earendil-works/chord";
import { Type, type Static } from "typebox";
import { ModelInfoSchema, ThinkingLevelSchema } from "./session.ts";

export const SessionInfoSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  createdAt: Type.Number(),
  lastMessageAt: Type.Number(),
});

export type SessionInfo = Static<typeof SessionInfoSchema>;

export const SessionListSchema = Type.Array(SessionInfoSchema);

export const ModelListSchema = Type.Array(ModelInfoSchema);

/** Durable registry of chat sessions; each id opens a `Session` object with replayable history. */
export const Sessions = remote("ultiv.sessions", {
  version: 2,
  input: Type.Object({}),
  host: hostNamed("server"),
  variants: {
    default: {
      state: {
        sessions: SessionListSchema,
        models: ModelListSchema,
      },
      methods: {
        create: method(
          Type.Object({ title: Type.Union([Type.String(), Type.Null()]) }),
          Type.Object({ id: Type.String() }),
        ),
        remove: method(Type.Object({ id: Type.String() }), Type.Object({ ok: Type.Boolean() })),
      },
    },
  },
});

export type Models = Static<typeof ModelListSchema>;
