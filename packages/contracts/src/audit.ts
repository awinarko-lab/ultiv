import { Type, type Static } from "typebox";

/**
 * One audited event: a tool call the act executed, or an approval decision a
 * user made. Append-only JSONL server-side; this is the read shape.
 */
export const AuditEventSchema = Type.Object({
  at: Type.Number(),
  kind: Type.Union([Type.Literal("tool_call"), Type.Literal("approval")]),
  conversationId: Type.String(),
  callId: Type.Union([Type.String(), Type.Null()]),
  name: Type.Union([Type.String(), Type.Null()]),
  durationMs: Type.Union([Type.Number(), Type.Null()]),
  ok: Type.Union([Type.Boolean(), Type.Null()]),
  error: Type.Union([Type.String(), Type.Null()]),
});

export type AuditEvent = Static<typeof AuditEventSchema>;

export const AuditListSchema = Type.Array(AuditEventSchema);

export type AuditList = Static<typeof AuditListSchema>;
