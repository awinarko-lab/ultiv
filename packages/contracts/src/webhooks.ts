import { Type, type Static } from "typebox";

/** One retained rejected payload (bounded, bodies truncated) for diagnosis. */
export const WebhookRejectSchema = Type.Object({
  at: Type.Number(),
  /** Rejection class: auth | schema | rate | size. */
  reason: Type.String(),
  /** Why the payload was refused (schema error detail, etc.). */
  detail: Type.String(),
  /** The first bytes of the rejected body — enough to diagnose, not enough to hurt. */
  body: Type.String(),
});

export type WebhookReject = Static<typeof WebhookRejectSchema>;

/**
 * A JSON-safe value: the recursive shape a JSON Schema document actually
 * has (objects, arrays, primitives — nothing host-language-typed), so a
 * webhook's schema is storable in a durable doc.
 */
export type JsonSchemaValue =
  | string
  | number
  | boolean
  | null
  | JsonSchemaValue[]
  | { [key: string]: JsonSchemaValue };

export type JsonSchemaObject = { [key: string]: JsonSchemaValue };

/**
 * One inbound webhook: a URL the outside world can POST to reach a session.
 * The bearer token is shown at creation and readable by the OWNER (user and
 * harness), never by the entity — key invisibility is the capability
 * boundary, and the reject counters below are what make rotation debuggable.
 */
export const WebhookInfoSchema = Type.Object({
  id: Type.String(),
  /** Bearer secret the caller must present; shown once at creation. */
  token: Type.String(),
  sessionId: Type.String(),
  /** The profile the bound session lives under. */
  profile: Type.String(),
  /** Optional label the creator gave this webhook. */
  name: Type.Union([Type.String(), Type.Null()]),
  /**
   * Optional JSON Schema (TypeBox-compatible) the ingress validates every
   * payload against BEFORE acking; null accepts any payload. Authored at
   * creation — schema rejections are the author's bug, not the sender's.
   */
  schema: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  createdAt: Type.Number(),
  /** Payloads that passed ingress and were queued for delivery. */
  accepted: Type.Number(),
  rejectedAuth: Type.Number(),
  rejectedSchema: Type.Number(),
  rejectedRate: Type.Number(),
  rejectedSize: Type.Number(),
  /** Fire receipts: payloads ever accepted (successful ingress). */
  fireCount: Type.Number(),
  lastFiredAt: Type.Union([Type.Number(), Type.Null()]),
  lastRejectAt: Type.Union([Type.Number(), Type.Null()]),
  /** Rejection class of the most recent reject ("auth" | "schema" | "rate" | "size"). */
  lastRejectReason: Type.Union([Type.String(), Type.Null()]),
  /** The last few rejected payloads, newest first — the schema-drift diagnosis path. */
  recentRejects: Type.Array(WebhookRejectSchema),
});

export type WebhookInfo = Omit<Static<typeof WebhookInfoSchema>, "schema"> & {
  schema: JsonSchemaObject | null;
};

export const WebhookListSchema = Type.Array(WebhookInfoSchema);

export type WebhookList = WebhookInfo[];
