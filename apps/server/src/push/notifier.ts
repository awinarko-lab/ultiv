/**
 * The push notifier: one short, secret-free payload to every device the
 * owner subscribed. Skipped while the owner has the app visible; the same
 * tag inside the collapse window is dropped (and the push service collapses
 * by Topic too); each owner gets a bounded number per minute. Dead
 * subscriptions (404/410) are pruned on the spot.
 */
import { createHash } from "node:crypto";
import type { Presence } from "./presence.ts";
import type { PushStore, PushSubscriptionRecord } from "./store.ts";

export interface PushPayload {
  readonly title: string;
  readonly body: string;
  /** The in-app path a tap opens, e.g. /c/<sessionId>. */
  readonly url: string;
  /** Same tag = same notification slot on the device and one push per window. */
  readonly tag: string;
  readonly urgency?: "normal" | "high";
}

export type PushSend = (
  subscription: PushSubscriptionRecord,
  body: string,
  options: { readonly topic: string; readonly urgency: "normal" | "high"; readonly TTL: number },
) => Promise<{ readonly statusCode: number }>;

export interface NotifierDeps {
  readonly store: PushStore;
  readonly presence: Presence;
  readonly send: PushSend;
  readonly now?: () => number;
}

export type NotifyOutcome = "sent" | "visible" | "duplicate" | "rate-limited" | "no-devices";

export interface Notifier {
  /** `ignoreVisible`: the owner asked for it (a test push), so an open tab does not skip it. */
  readonly notify: (
    owner: string,
    payload: PushPayload,
    options?: { readonly ignoreVisible?: boolean },
  ) => Promise<NotifyOutcome>;
}

export const COLLAPSE_WINDOW_MS = 30_000;
export const MAX_PER_MINUTE = 6;
const TTL_SECONDS = 60 * 60;

/** The push service's Topic header: ≤32 URL-safe base64 characters. */
export const topicOf = (tag: string): string =>
  createHash("sha256").update(tag).digest("base64url").slice(0, 32);

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** Only in-app paths may ride a payload; anything else opens the home page. */
const safePath = (url: string): string => (/^\/[A-Za-z0-9/_\-.]*$/.test(url) ? url : "/");

export const makeNotifier = (deps: NotifierDeps): Notifier => {
  const now = deps.now ?? Date.now;
  const lastByTag = new Map<string, number>();
  const recent = new Map<string, number[]>();
  const admit = (owner: string, tag: string): NotifyOutcome | null => {
    const at = now();
    const key = `${owner}\u0000${tag}`;
    if (at - (lastByTag.get(key) ?? -Infinity) < COLLAPSE_WINDOW_MS) return "duplicate";
    const window = (recent.get(owner) ?? []).filter((t) => at - t < 60_000);
    if (window.length >= MAX_PER_MINUTE) return "rate-limited";
    lastByTag.set(key, at);
    recent.set(owner, [...window, at]);
    return null;
  };
  return {
    notify: async (owner, payload, options) => {
      if (options?.ignoreVisible !== true && deps.presence.isVisible(owner)) return "visible";
      const devices = deps.store.list(owner);
      if (devices.length === 0) return "no-devices";
      const refused = admit(owner, payload.tag);
      if (refused !== null) return refused;
      const body = JSON.stringify({
        title: clip(payload.title, 80),
        body: clip(payload.body, 140),
        url: safePath(payload.url),
        tag: clip(payload.tag, 64),
      });
      const sendOptions = {
        topic: topicOf(payload.tag),
        urgency: payload.urgency ?? "normal",
        TTL: TTL_SECONDS,
      };
      await Promise.all(
        devices.map(async (device) => {
          try {
            await deps.send(device, body, sendOptions);
          } catch (cause) {
            const status = (cause as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) deps.store.remove(owner, device.endpoint);
            else
              console.error(`push to ${new URL(device.endpoint).host} failed (${status ?? "?"})`);
          }
        }),
      );
      return "sent";
    },
  };
};
