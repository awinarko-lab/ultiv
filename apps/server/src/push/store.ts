/**
 * Push subscriptions, owner-scoped, in one small JSON file under PUSH_DIR
 * (0600, written atomically). A subscription is an endpoint plus the
 * browser's encryption keys; nothing else about the device is kept.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isPushEndpoint } from "./endpoint.ts";

export interface PushSubscriptionRecord {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
  readonly createdAt: number;
}

export interface PushStore {
  readonly list: (owner: string) => readonly PushSubscriptionRecord[];
  /** Validates and upserts; returns an error string when refused. */
  readonly add: (owner: string, input: unknown) => string | null;
  readonly remove: (owner: string, endpoint: string) => boolean;
}

type Shape = Record<string, PushSubscriptionRecord[]>;

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,200}={0,2}$/;

/** The browser's PushSubscription JSON, checked field by field. */
export const parseSubscription = (input: unknown): PushSubscriptionRecord | string => {
  const value = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof value?.endpoint === "string" ? value.endpoint : "";
  if (endpoint.length > 1000 || !isPushEndpoint(endpoint)) return "not a browser push endpoint";
  const p256dh = value.keys?.p256dh;
  const auth = value.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string") return "missing keys";
  if (!KEY_PATTERN.test(p256dh) || !KEY_PATTERN.test(auth)) return "malformed keys";
  return { endpoint, keys: { p256dh, auth }, createdAt: Date.now() };
};

/** At most this many devices per owner; the oldest falls off. */
const MAX_PER_OWNER = 10;

export const makePushStore = (dir: string): PushStore => {
  const file = join(dir, "subscriptions.json");
  const read = (): Shape => {
    if (!existsSync(file)) return {};
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Shape;
    } catch {
      return {};
    }
  };
  const write = (shape: Shape): void => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(shape), { mode: 0o600 });
    renameSync(tmp, file);
    chmodSync(file, 0o600);
  };
  return {
    list: (owner) => read()[owner] ?? [],
    add: (owner, input) => {
      const parsed = parseSubscription(input);
      if (typeof parsed === "string") return parsed;
      const shape = read();
      const others = (shape[owner] ?? []).filter((sub) => sub.endpoint !== parsed.endpoint);
      shape[owner] = [...others, parsed].slice(-MAX_PER_OWNER);
      write(shape);
      return null;
    },
    remove: (owner, endpoint) => {
      const shape = read();
      const before = shape[owner] ?? [];
      const after = before.filter((sub) => sub.endpoint !== endpoint);
      if (after.length === before.length) return false;
      shape[owner] = after;
      write(shape);
      return true;
    },
  };
};
