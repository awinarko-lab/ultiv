import { Type, type Static } from "typebox";

/**
 * One inter-entity message. The lineage `chain` doubles as a trace id: one
 * cron fire fanning out across profiles correlates by it. Also the future
 * federation wire format — external senders carry `from: "external:{name}"`
 * with strictly fewer rights (no artifact grants, never autonomous).
 */
export const MailboxEnvelopeSchema = Type.Object({
  id: Type.String(),
  /** Profile ids the message has passed through, sender first. */
  chain: Type.Array(Type.String()),
  from: Type.String(),
  to: Type.String(),
  kind: Type.Union([
    Type.Literal("request"),
    Type.Literal("notify"),
    Type.Literal("reply"),
    Type.Literal("nack"),
  ]),
  replyTo: Type.Union([Type.String(), Type.Null()]),
  /** The room topic this envelope belongs to (rooms are contextual). */
  topic: Type.Optional(Type.String()),
  body: Type.String(),
  /** Cross-profile artifact grants; internal senders only. */
  artifacts: Type.Array(Type.String()),
  at: Type.Number(),
});

export type MailboxEnvelope = Static<typeof MailboxEnvelopeSchema>;

/** One mailbox record: the envelope plus its delivery state. */
export const MailboxEntrySchema = Type.Object({
  envelope: MailboxEnvelopeSchema,
  status: Type.Union([
    Type.Literal("pending"),
    Type.Literal("replied"),
    Type.Literal("failed"),
    Type.Literal("dead"),
  ]),
  /** Settled turn attempts so far (re-delivery on failure, capped). */
  retries: Type.Number(),
  deliveredAt: Type.Union([Type.Number(), Type.Null()]),
  settledAt: Type.Union([Type.Number(), Type.Null()]),
  error: Type.Union([Type.String(), Type.Null()]),
});

export type MailboxEntry = Static<typeof MailboxEntrySchema>;

export const MailboxListSchema = Type.Array(MailboxEntrySchema);

export type MailboxList = Static<typeof MailboxListSchema>;
