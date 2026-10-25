import { Type, type Static } from "typebox";
import { ModelInfoSchema } from "./session.ts";

export const SessionInfoSchema = Type.Object({
  id: Type.String(),
  /** Registry owner the session belongs to (header-scoped; "guest" unauthenticated). */
  owner: Type.String(),
  title: Type.String(),
  createdAt: Type.Number(),
  lastMessageAt: Type.Number(),
});

export type SessionInfo = Static<typeof SessionInfoSchema>;

export const SessionListSchema = Type.Array(SessionInfoSchema);

export type SessionList = Static<typeof SessionListSchema>;

export const ModelListSchema = Type.Array(ModelInfoSchema);

export type Models = Static<typeof ModelListSchema>;

/**
 * The session registry is served as plain REST (`/api/sessions`, `/api/models`
 * on the server's HTTP handler), not as a chord object: it is CRUD, not
 * replicated state, and chord 1.4.0's wire replication desyncs on attach.
 * These schemas are the REST payload shapes.
 */
