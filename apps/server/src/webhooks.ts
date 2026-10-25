/**
 * Inbound webhooks: the door the outside world knocks on. A webhook binds a
 * random id + bearer token to one session; a POST carrying the token delivers
 * the body into that session's conversation as an input. Tokens are shown at
 * creation and stored in plain text server-side — the registry doc never
 * leaves the process except as the creation response.
 */
import { randomUUID } from "node:crypto";
import { defineDoc } from "@earendil-works/pi-durable";
import { Effect } from "effect";
import type { WebhookInfo, WebhookList } from "@ultiv/contracts";
import type { MindService } from "@ultiv/mind";
import { deliverToSession } from "./deliver.ts";

const WebhooksDoc = defineDoc<{ items: WebhookInfo[] }>({
  kind: "ultiv.webhooks",
  version: 2,
  scope: "session",
  initial: () => ({ items: [] }),
  // v1 rows predate profile scoping.
  migrate: (value) => {
    const stored = (value.items ?? []) as unknown as ReadonlyArray<Record<string, unknown>>;
    const items = stored.map((row) => ({
      ...row,
      profile: typeof row.profile === "string" ? row.profile : "default",
    }));
    return { items } as unknown as { items: WebhookInfo[] };
  },
  checkpointWhen: () => true,
});

export const listWebhooks = async (mind: MindService): Promise<WebhookList> =>
  ((await Effect.runPromise(mind.converse.docs.snapshot(WebhooksDoc)))?.items ?? []).map(
    (webhook) => ({ ...webhook, profile: webhook.profile ?? "default" }),
  );

export const createWebhook = async (mind: MindService, sessionId: string): Promise<WebhookInfo> => {
  const row = await mind.profiles.rowOf(sessionId);
  const webhook: WebhookInfo = {
    id: randomUUID(),
    token: randomUUID(),
    sessionId,
    profile: row?.profile ?? "default",
    createdAt: Date.now(),
    calls: 0,
  };
  await Effect.runPromise(
    mind.converse.docs.commit(async (tx) => {
      const draft = await tx.doc(WebhooksDoc);
      draft.items = [...draft.items, webhook];
    }),
  );
  return webhook;
};

export const removeWebhook = async (mind: MindService, id: string): Promise<boolean> => {
  let removed = false;
  await Effect.runPromise(
    mind.converse.docs.commit(async (tx) => {
      const draft = await tx.doc(WebhooksDoc);
      const before = draft.items.length;
      draft.items = draft.items.filter((webhook) => webhook.id !== id);
      removed = draft.items.length < before;
    }),
  );
  return removed;
};

/** Deliver one authenticated webhook call; true when the token matched. */
export const callWebhook = async (
  mind: MindService,
  id: string,
  token: string,
  body: string,
): Promise<boolean> => {
  const webhooks = await listWebhooks(mind);
  const webhook = webhooks.find((candidate) => candidate.id === id);
  if (webhook === undefined || webhook.token !== token) return false;
  await Effect.runPromise(
    mind.converse.docs.commit(async (tx) => {
      const draft = await tx.doc(WebhooksDoc);
      draft.items = draft.items.map((candidate) =>
        candidate.id === id ? { ...candidate, calls: candidate.calls + 1 } : candidate,
      );
    }),
  );
  const text = body.trim() === "" ? `[webhook ${id}] (empty body)` : `[webhook ${id}] ${body}`;
  await deliverToSession(mind, webhook.sessionId, text);
  return true;
};
