/**
 * The inter-entity mailbox: asynchronous, durable messaging between bots in
 * CONTEXTUAL rooms. Each room gives every participant their OWN conversation
 * (identity section, memory scope, persona are per-entity — a room is never a
 * shared transcript), so a pair may hold many rooms by topic and groups work
 * the same way. Delivery semantics mirror deliver.ts — admission is the
 * contract, the turn settles in the background, a failed turn is a NACK —
 * plus the safety rules that make a team of bots affordable: lineage hop
 * caps, cycle refusal, per-pair rate limits, per-profile daily budgets, lane
 * caps, and bounded retries with dead-lettering. Replies and NACKs wake the
 * sender in THEIR seat of the room — never their main chat, never a session
 * list.
 */
import { randomUUID } from "node:crypto";
import { defineDoc } from "@earendil-works/pi-durable";
import { Effect } from "effect";
import { InvalidInput, NotFound } from "@ultiv/core";
import type { MailboxEntry, MailboxEnvelope, MailboxList } from "@ultiv/contracts";
import type { AuditService } from "../audit/audit.ts";
import type { ConverseService } from "../converse/converse.ts";
import { roomConversationKey } from "../profiles/rooms.ts";
import type { ProfilesService } from "../profiles/profiles.ts";
import type { RoomsService } from "../profiles/rooms.ts";

export const MailboxDoc = defineDoc<{ items: MailboxEntry[] }>({
  kind: "ultiv.mailbox",
  version: 1,
  scope: "session",
  initial: () => ({ items: [] }),
  checkpointWhen: () => true,
});

/** Loop and cost safety defaults (RFC 0001 §5.1–5.2). */
export const HOP_CAP = 3;
export const PAIR_RATE_PER_HOUR = 10;
export const EXTERNAL_RATE_PER_HOUR = 5;
export const MAX_RETRIES = 3;
export const WAKE_DIGEST_CHARS = 4_000;
/**
 * Ad-hoc room exchange cap: a bot may send at most this many tool-initiated
 * messages into one room (pair + topic), so two bots never loop forever.
 * Deliberate paths (REST/owner sends) are exempt.
 */
export const ROOM_EXCHANGE_CAP = 3;

const isExternal = (id: string): boolean => id.startsWith("external:");

/** A counting lane: N holders at once, everyone else waits in FIFO order. */
class Lane {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly cap: number;
  constructor(cap: number) {
    this.cap = cap;
  }
  readonly acquire = (): Promise<() => void> =>
    new Promise((resolve) => {
      const release = (): void => {
        this.active -= 1;
        const next = this.waiting.shift();
        if (next !== undefined) next();
      };
      if (this.active < this.cap) {
        this.active += 1;
        resolve(release);
      } else {
        this.waiting.push(() => {
          this.active += 1;
          resolve(release);
        });
      }
    });
}

export type MailboxOrigin = "tool" | "human" | "cron" | "external";

export interface MailboxSendInput {
  readonly owner: string;
  readonly from: string;
  readonly to: string;
  readonly kind: "request" | "notify";
  readonly body: string;
  readonly artifacts?: readonly string[];
  readonly origin: MailboxOrigin;
  /** The room's context — a pair may hold many concurrent threads. */
  readonly topic?: string;
}

export interface MailboxService {
  /** Send (admit) a message; validations refuse before anything is admitted. */
  readonly send: (input: MailboxSendInput) => Promise<MailboxEntry>;
  /** An inbound envelope from an external sender: strictly fewer rights. */
  readonly deliverExternal: (
    input: Omit<MailboxSendInput, "origin" | "owner"> & {
      readonly owner: string;
      readonly chain: readonly string[];
    },
  ) => Promise<MailboxEntry>;
  /** Entries visible to an owner (their bots' traffic), newest last. */
  readonly list: (owner: string) => Promise<MailboxList>;
  /** Dead-lettered entries — the attention path reads this. */
  readonly dead: (owner: string) => Promise<MailboxList>;
  /** Remove every entry touching a profile (purge cascade). */
  readonly purgeProfile: (owner: string, profileId: string) => Promise<number>;
}

const run = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(effect) as Promise<A>;

const readEntries = (converse: ConverseService): Promise<MailboxEntry[]> =>
  run(converse.docs.snapshot(MailboxDoc)).then((doc) =>
    (doc?.items ?? []).map((entry) => ({
      ...entry,
      envelope: { ...entry.envelope, topic: entry.envelope.topic ?? "" },
    })),
  );

const writeEntries = (
  converse: ConverseService,
  change: (items: MailboxEntry[]) => MailboxEntry[],
): Promise<void> =>
  run(
    converse.docs.commit(async (tx) => {
      const draft = await tx.doc(MailboxDoc);
      draft.items = change(draft.items);
    }),
  );

const updateEntry = (
  converse: ConverseService,
  id: string,
  patch: Partial<Pick<MailboxEntry, "status" | "retries" | "deliveredAt" | "settledAt" | "error">>,
): Promise<void> =>
  writeEntries(converse, (items) =>
    items.map((entry) => (entry.envelope.id === id ? { ...entry, ...patch } : entry)),
  );

const envelopeText = (envelope: MailboxEnvelope, fromName: string, topic: string): string => {
  const grants =
    envelope.artifacts.length > 0 ? `\n\nGranted artifacts: ${envelope.artifacts.join(", ")}` : "";
  const room = topic === "" ? "" : ` • ${topic}`;
  // The answer expectation is explicit: the recipient must never have to
  // guess whether this thread is asking them or informing them.
  const expectation =
    envelope.kind === "request"
      ? "\n\n(This is a direct request TO YOU. Reply in this conversation with your answer — nothing else is needed.)"
      : "\n\n(This is a notification. NO reply is needed — do not message back.)";
  return `[message from ${fromName}${room} • ${envelope.kind} • re: ${envelope.id}]${grants}\n\n${envelope.body}${expectation}`;
};

const dayStart = (): number => {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
};

export const mailboxService = (deps: {
  readonly converse: ConverseService;
  readonly profiles: ProfilesService;
  readonly rooms: RoomsService;
  readonly audit: AuditService;
  readonly options?: {
    readonly globalLanes?: number;
    readonly profileLanes?: number;
    readonly retryDelayMs?: number;
  };
}): MailboxService => {
  const { converse, profiles, rooms, audit } = deps;
  const globalLane = new Lane(deps.options?.globalLanes ?? 3);
  const profileLanes = new Map<string, Lane>();
  const profileLane = (id: string): Lane => {
    let lane = profileLanes.get(id);
    if (lane === undefined) {
      lane = new Lane(deps.options?.profileLanes ?? 2);
      profileLanes.set(id, lane);
    }
    return lane;
  };
  const retryDelayMs = deps.options?.retryDelayMs ?? 5_000;

  /** A minimal room handle for wakes and NACKs (id + topic + participants). */
  interface RoomRef {
    readonly id: string;
    readonly topic: string;
    readonly participants: readonly string[];
  }

  /** Wake a profile inside their own seat of the room — never the main chat. */
  const wakeInRoom = async (
    owner: string,
    room: RoomRef,
    profileId: string,
    text: string,
  ): Promise<void> => {
    try {
      const seat = await run(converse.ensure(roomConversationKey(owner, room.id, profileId)));
      const submission = await run(converse.submit(seat, text));
      void run(converse.settle(seat, submission)).catch(() => undefined);
      await rooms.touch(owner, room.id);
    } catch (cause) {
      console.error("mailbox wake failed:", cause);
    }
  };

  const notifyDead = (entry: MailboxEntry, owner: string, room: RoomRef, toName: string): void => {
    const text = `[nack from ${toName} • re: ${entry.envelope.id}] no reply after ${entry.retries} attempts: ${entry.error ?? "unknown error"}`;
    audit.record({
      at: Date.now(),
      kind: "mailbox",
      conversationId: "mailbox",
      profile: entry.envelope.from,
      callId: null,
      name: "dead",
      durationMs: null,
      ok: false,
      error: text.slice(0, 300),
    });
    void wakeInRoom(owner, room, entry.envelope.from, text);
  };

  /**
   * Deliver one envelope to its recipient's seat. At-least-once: a retry
   * after a failed settle re-admits the envelope (a duplicate input in the
   * seat is the documented cost; admission is the contract).
   */
  const runDelivery = async (entry: MailboxEntry, owner: string, topic: string): Promise<void> => {
    const envelope = entry.envelope;
    const releaseGlobal = await globalLane.acquire();
    const releaseProfile = await profileLane(envelope.to).acquire();
    try {
      const [fromProfile, toProfile, room] = await Promise.all([
        isExternal(envelope.from) ? Promise.resolve(undefined) : profiles.get(owner, envelope.from),
        profiles.get(owner, envelope.to),
        rooms.ensure(owner, [envelope.from, envelope.to], topic),
      ]);
      const seat = await run(converse.ensure(roomConversationKey(owner, room.id, envelope.to)));
      const submission = await run(
        converse.submit(
          seat,
          envelopeText(envelope, fromProfile?.name ?? envelope.from, room.topic),
        ),
      );
      await updateEntry(converse, envelope.id, { deliveredAt: Date.now() });
      await rooms.touch(owner, room.id);
      const result = await run(converse.settle(seat, submission));
      await updateEntry(converse, envelope.id, {
        status: "replied",
        settledAt: Date.now(),
        error: null,
      });
      if (envelope.kind === "request") {
        const digest =
          result.text.length > WAKE_DIGEST_CHARS
            ? `${result.text.slice(0, WAKE_DIGEST_CHARS)}\n[truncated — full reply in the room]`
            : result.text;
        await wakeInRoom(
          owner,
          room,
          envelope.from,
          `[reply from ${toProfile?.name ?? envelope.to} • re: ${envelope.id}]\n\n${digest}`,
        );
      }
    } catch (cause) {
      const retries = entry.retries + 1;
      const error = String(cause).slice(0, 300);
      if (retries < MAX_RETRIES) {
        await updateEntry(converse, envelope.id, { retries, error });
        setTimeout(() => {
          void runDelivery({ ...entry, retries }, owner, topic).catch(() => undefined);
        }, retryDelayMs).unref?.();
      } else {
        const toProfile = await profiles.get(owner, envelope.to);
        const room = await rooms.ensure(owner, [envelope.from, envelope.to], topic);
        await updateEntry(converse, envelope.id, { retries, error, status: "dead" });
        notifyDead({ ...entry, retries, error }, owner, room, toProfile?.name ?? envelope.to);
      }
    } finally {
      releaseProfile();
      releaseGlobal();
    }
  };

  const validate = async (
    owner: string,
    from: string,
    to: string,
    chain: readonly string[],
    artifacts: readonly string[],
    origin: MailboxOrigin,
    topic: string,
  ): Promise<void> => {
    if (from === to) throw new InvalidInput({ reason: "cannot message yourself" });
    if (chain.includes(to)) {
      throw new InvalidInput({ reason: `cycle refused: ${to} is already in the chain` });
    }
    if (chain.length >= HOP_CAP) {
      throw new InvalidInput({ reason: `hop cap reached (${HOP_CAP})` });
    }
    const fromProfile = isExternal(from) ? undefined : await profiles.get(owner, from);
    const toProfile = await profiles.get(owner, to);
    if (fromProfile === undefined && !isExternal(from)) {
      throw new NotFound({ what: `profile ${from}` });
    }
    if (toProfile === undefined) throw new NotFound({ what: `profile ${to}` });
    if (toProfile.archivedAt !== null) {
      throw new InvalidInput({ reason: `profile ${to} is archived` });
    }
    if (!isExternal(from) && fromProfile !== undefined && fromProfile.archivedAt !== null) {
      throw new InvalidInput({ reason: "archived profiles cannot send" });
    }
    if (isExternal(from) && artifacts.length > 0) {
      throw new InvalidInput({ reason: "external senders cannot carry artifact grants" });
    }
    if (origin === "tool") {
      // Open by default: `*` reaches every sibling; an explicit list
      // restricts; an empty list locks the profile out of the mailbox.
      const allowed = fromProfile?.policies.canInitiate ?? [];
      const mayInitiate = allowed.includes("*") || allowed.includes(to);
      if (!mayInitiate) {
        throw new InvalidInput({ reason: `not allowed to initiate contact with ${to}` });
      }
    }
    const entries = await readEntries(converse);
    const hourAgo = Date.now() - 3_600_000;
    const pairRate = isExternal(from) ? EXTERNAL_RATE_PER_HOUR : PAIR_RATE_PER_HOUR;
    const between = entries.filter(
      (candidate) =>
        candidate.envelope.at > hourAgo &&
        ((candidate.envelope.from === from && candidate.envelope.to === to) ||
          (candidate.envelope.from === to && candidate.envelope.to === from)),
    );
    if (between.length >= pairRate) {
      throw new InvalidInput({ reason: `pair rate limit reached (${pairRate}/hour)` });
    }
    if (origin === "tool") {
      // Ad-hoc rooms don't run forever: cap each bot's sends per room
      // (pair + topic) so back-and-forth converges instead of looping.
      const inRoom = entries.filter(
        (candidate) =>
          candidate.envelope.from === from &&
          candidate.envelope.to === to &&
          (candidate.envelope.topic ?? "") === topic,
      );
      if (inRoom.length >= ROOM_EXCHANGE_CAP) {
        throw new InvalidInput({
          reason:
            `room exchange cap reached (${ROOM_EXCHANGE_CAP} messages per bot per thread) — ` +
            "conclude here; open a new topic if more is needed",
        });
      }
    }
    const budget = fromProfile?.policies.dailyTurnBudget ?? null;
    if (budget !== null && !isExternal(from)) {
      const today = dayStart();
      const sent = entries.filter(
        (candidate) => candidate.envelope.from === from && candidate.envelope.at >= today,
      );
      if (sent.length >= budget) {
        throw new InvalidInput({ reason: `daily turn budget reached (${budget})` });
      }
    }
  };

  const admit = async (
    owner: string,
    envelope: MailboxEnvelope,
    topic: string,
  ): Promise<MailboxEntry> => {
    const entry: MailboxEntry = {
      envelope,
      status: "pending",
      retries: 0,
      deliveredAt: null,
      settledAt: null,
      error: null,
    };
    await writeEntries(converse, (items) => [...items, entry]);
    audit.record({
      at: Date.now(),
      kind: "mailbox",
      conversationId: "mailbox",
      profile: envelope.from,
      callId: envelope.id,
      name: "send",
      durationMs: null,
      ok: true,
      error: null,
    });
    void runDelivery(entry, owner, topic).catch((cause) => {
      console.error("mailbox delivery failed:", cause);
    });
    return entry;
  };

  const service: MailboxService = {
    send: async (input) => {
      const topic = (input.topic ?? "").trim();
      await validate(
        input.owner,
        input.from,
        input.to,
        [input.from],
        input.artifacts ?? [],
        input.origin,
        topic,
      );
      const envelope: MailboxEnvelope = {
        id: randomUUID(),
        chain: [input.from],
        from: input.from,
        to: input.to,
        kind: input.kind,
        replyTo: null,
        ...(topic !== "" ? { topic } : {}),
        body: input.body.slice(0, 20_000),
        artifacts: [...(input.artifacts ?? [])],
        at: Date.now(),
      };
      return admit(input.owner, envelope, topic);
    },
    deliverExternal: async (input) => {
      const sender = `external:${input.from.replace(/^external:/, "")}`;
      const chain = [...input.chain, sender];
      const topic = (input.topic ?? "").trim();
      await validate(input.owner, sender, input.to, chain, [], "external", topic);
      const envelope: MailboxEnvelope = {
        id: randomUUID(),
        chain,
        from: sender,
        to: input.to,
        kind: input.kind,
        replyTo: null,
        ...(topic !== "" ? { topic } : {}),
        body: input.body.slice(0, 20_000),
        artifacts: [],
        at: Date.now(),
      };
      return admit(input.owner, envelope, topic);
    },
    list: async (owner) => {
      const entries = await readEntries(converse);
      const owned = new Set((await profiles.list(owner)).map((profile) => profile.id));
      return entries.filter(
        (entry) => owned.has(entry.envelope.from) || owned.has(entry.envelope.to),
      );
    },
    dead: (owner) =>
      service.list(owner).then((entries) => entries.filter((entry) => entry.status === "dead")),
    purgeProfile: (owner, profileId) =>
      readEntries(converse).then(async (entries) => {
        const remaining = entries.filter(
          (entry) => entry.envelope.from !== profileId && entry.envelope.to !== profileId,
        );
        await writeEntries(converse, () => remaining);
        return entries.length - remaining.length;
      }),
  };
  return service;
};
