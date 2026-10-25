import { Type, type Static } from "typebox";

/** One inbound webhook: a URL the outside world can POST to reach a session. */
export const WebhookInfoSchema = Type.Object({
  id: Type.String(),
  /** Bearer secret the caller must present; shown once at creation. */
  token: Type.String(),
  sessionId: Type.String(),
  /** The profile the bound session lives under. */
  profile: Type.String(),
  createdAt: Type.Number(),
  calls: Type.Number(),
});

export type WebhookInfo = Static<typeof WebhookInfoSchema>;

export const WebhookListSchema = Type.Array(WebhookInfoSchema);

export type WebhookList = Static<typeof WebhookListSchema>;
