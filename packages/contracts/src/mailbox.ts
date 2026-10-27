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
    /** No reply before the deadline; the sender was told. */
    Type.Literal("expired"),
    /** The owner cancelled it before the recipient started on it. */
    Type.Literal("cancelled"),
  ]),
  /** Settled turn attempts so far (re-delivery on failure, capped). */
  retries: Type.Number(),
  deliveredAt: Type.Union([Type.Number(), Type.Null()]),
  settledAt: Type.Union([Type.Number(), Type.Null()]),
  error: Type.Union([Type.String(), Type.Null()]),
  /** Owning principal (entries predate this field normalize to ""). */
  owner: Type.Optional(Type.String()),
  /** How the send entered: tool sends are exchange-capped, deliberate ones are not. */
  origin: Type.Optional(
    Type.Union([
      Type.Literal("tool"),
      Type.Literal("human"),
      Type.Literal("cron"),
      Type.Literal("external"),
    ]),
  ),
  /**
   * The conversation the send was made FROM (the tunnel's near endpoint):
   * replies and NACKs are signalled back here — a session if the exchange
   * started there, otherwise the bot's main thread.
   */
  originConversation: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  /** Epoch ms after which a still-pending message expires and the sender is told. */
  deadlineAt: Type.Optional(Type.Number()),
  /** The conversation the envelope was delivered into (fixed after the first attempt). */
  endpoint: Type.Optional(Type.String()),
  /** The durable submission of the latest attempt, so it can be withdrawn. */
  submissionId: Type.Optional(Type.String()),
  /** false = a finish signal or NACK is still owed to the sender (re-sent on boot). */
  senderNotified: Type.Optional(Type.Boolean()),
});

export type MailboxEntry = Static<typeof MailboxEntrySchema>;

export const MailboxListSchema = Type.Array(MailboxEntrySchema);

export type MailboxList = Static<typeof MailboxListSchema>;
