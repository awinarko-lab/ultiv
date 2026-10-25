/**
 * The inter-entity mailbox: asynchronous, durable messaging where the ROOM is
 * a pure TUNNEL. An exchange runs between two endpoint conversations — the
 * sender's origin thread (their main chat, or the session they were working
 * in when they sent) and the counterpart's MAIN thread. All thinking happens
 * at the endpoints; the tunnel carries only the exchanged envelopes, and its
 * transcript is the mailbox entries (readable end-to-end with the `room`
 * tool). Wakes carry a FINISH SIGNAL plus a pointer, never a transcript copy.
 * Delivery semantics mirror deliver.ts — admission is the contract, the turn
 * settles in the background, a failed turn is a NACK — plus the safety rules
 * that make a team of bots affordable: lineage hop caps, cycle refusal,
 * per-pair rate limits, per-pair exchange caps, per-profile daily budgets,
 * lane caps, and bounded retries with dead-lettering.
 */
import { randomUUID } from "node:crypto";
import { defineDoc } from "@earendil-works/pi-durable";
import { Effect } from "effect";
import { InvalidInput, NotFound } from "@ultiv/core";
import type { MailboxEntry, MailboxEnvelope, MailboxList } from "@ultiv/contracts";
import type { AuditService } from "../audit/audit.ts";
import type { ConverseService } from "../converse/converse.ts";
import type { ProfilesService } from "../profiles/profiles.ts";
import type { RoomsService } from "../profiles/rooms.ts";
import type { RoomInfo } from "@ultiv/contracts";

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
/**
 * Ad-hoc exchange cap: a bot may send at most this many tool-initiated
 * messages to one sibling (all topics/rooms combined), so two bots never
 * loop forever. Deliberate paths (REST/owner sends) are exempt.
 */
export const ROOM_EXCHANGE_CAP = 3;

/**
 * After a request's turn settles: the sender is woken with a finish signal
 * ONLY if the recipient did not already reply through the tunnel — a real
 * reply envelope delivers to the sender's endpoint on its own, and signalling
 * as well would double-wake them (two turns, two answers, cascade to the cap).
 */
export const shouldSignalReply = (
  envelope: MailboxEnvelope,
  entriesAfter: readonly MailboxEntry[],
): boolean =>
  !entriesAfter.some(
    (candidate) =>
      candidate.envelope.from === envelope.to &&
      candidate.envelope.to === envelope.from &&
      candidate.envelope.at > envelope.at,
  );

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
  /**
   * The conversation this send is made FROM (the tunnel's near endpoint).
   * Replies and NACKs are signalled back here; omit for the main thread.
   */
  readonly originConversation?: string | null;
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
  /** Tool sends from `from` to `to` against the exchange cap (used/cap). */
  readonly budgetOf: (
    owner: string,
    from: string,
    to: string,
  ) => Promise<{ readonly used: number; readonly cap: number }>;
  /** Dead-lettered entries — the attention path reads this. */
  readonly dead: (owner: string) => Promise<MailboxList>;
  /**
   * The tunnel transcript for a room: every exchanged envelope,
   * speaker-labelled, oldest first. This is what endpoints read.
   */
  readonly transcriptOf: (
    owner: string,
    room: RoomInfo,
  ) => Promise<
    readonly {
      readonly at: number;
      readonly speaker: string;
      readonly text: string;
      readonly system: boolean;
    }[]
  >;
  /** The conversation a profile tunnels at in a room (their latest send origin, else main). */
  readonly endpointOf: (owner: string, room: RoomInfo, profileId: string) => Promise<string>;
  /** Remove every entry touching a profile (purge cascade). */
  readonly purgeProfile: (owner: string, profileId: string) => Promise<number>;
}

const run = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(effect) as Promise<A>;

const readEntries = (converse: ConverseService): Promise<MailboxEntry[]> =>
  run(converse.docs.snapshot(MailboxDoc)).then((doc) =>
    (doc?.items ?? []).map((entry) => ({
      ...entry,
      owner: entry.owner ?? "",
      origin: entry.origin ?? "tool",
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
  // guess whether this thread is asking them or informing them. The request
  // arrives ON their main thread — the work happens here, the answer goes
  // back through the tunnel.
  const expectation =
    envelope.kind === "request"
      ? `\n\n(This is a direct request TO YOU, delivered to your main thread. Think and work HERE, then send your answer back with the message tool${room === "" ? "" : ` (same topic: ${topic})`}. Your owner can read this thread.)`
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

  /** The bot's main-chat conversation id — the default tunnel endpoint. */
  const mainConversationId = async (owner: string, profileId: string): Promise<string> => {
    const row = await profiles.ensureMain(owner, profileId);
    const key = await profiles.keyOfRow(row);
    const cid = await run(converse.conversationIdOf(key));
    if (cid !== undefined) return String(cid);
    const chat = await run(converse.ensure(key));
    return String(chat.id);
  };

  /**
   * Where a profile tunnels at in this room: the thread they last sent FROM
   * here (a session, if the exchange started in one), else their main chat.
   */
  const endpointOf = async (
    owner: string,
    room: RoomRef,
    profileId: string,
    entries: readonly MailboxEntry[],
  ): Promise<string> => {
    const mine = entries
      .filter(
        (candidate) =>
          (candidate.owner ?? "") === owner &&
          candidate.envelope.topic === room.topic &&
          candidate.envelope.from === profileId &&
          candidate.originConversation != null,
      )
      .sort((a, b) => a.envelope.at - b.envelope.at);
    const last = mine[mine.length - 1];
    return last?.originConversation ?? (await mainConversationId(owner, profileId));
  };

  /** Submit a signal into a conversation and settle it in the background. */
  const wakeConversation = async (conversationId: string, text: string): Promise<void> => {
    try {
      const chat = await run(converse.open(conversationId));
      if (chat === undefined) return;
      const submission = await run(converse.submit(chat, text));
      void run(converse.settle(chat, submission)).catch(() => undefined);
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
      callId: entry.envelope.id,
      name: "dead",
      durationMs: null,
      ok: false,
      error: text.slice(0, 300),
    });
    const wakeTarget = isExternal(entry.envelope.from)
      ? undefined
      : (entry.originConversation ?? undefined);
    if (wakeTarget !== undefined) void wakeConversation(wakeTarget, text);
    else if (!isExternal(entry.envelope.from))
      void mainConversationId(owner, entry.envelope.from).then((id) => wakeConversation(id, text));
  };

  /**
   * Deliver one envelope to the recipient's ENDPOINT conversation (their main
   * thread, or the thread they tunnel at). At-least-once: a retry after a
   * failed settle re-admits the envelope (a duplicate input at the endpoint
   * is the documented cost; admission is the contract).
   */
  const runDelivery = async (entry: MailboxEntry, owner: string, topic: string): Promise<void> => {
    const envelope = entry.envelope;
    const releaseGlobal = await globalLane.acquire();
    const releaseProfile = await profileLane(envelope.to).acquire();
    try {
      const [fromProfile, toProfile, room, entries] = await Promise.all([
        isExternal(envelope.from) ? Promise.resolve(undefined) : profiles.get(owner, envelope.from),
        profiles.get(owner, envelope.to),
        rooms.ensure(owner, [envelope.from, envelope.to], topic),
        readEntries(converse),
      ]);
      const endpointId = await endpointOf(owner, room, envelope.to, entries);
      const endpoint = await run(converse.open(endpointId));
      if (endpoint === undefined) throw new Error(`tunnel endpoint ${endpointId} unmapped`);
      const submission = await run(
        converse.submit(
          endpoint,
          envelopeText(envelope, fromProfile?.name ?? envelope.from, room.topic),
        ),
      );
      await updateEntry(converse, envelope.id, { deliveredAt: Date.now() });
      await rooms.touch(owner, room.id);
      await run(converse.settle(endpoint, submission));
      await updateEntry(converse, envelope.id, {
        status: "replied",
        settledAt: Date.now(),
        error: null,
      });
      if (envelope.kind === "request" && !isExternal(envelope.from)) {
        // A finish SIGNAL, not a transcript copy — and ONLY when the recipient
        // did not reply through the tunnel (their reply envelope already woke
        // the sender; a second signal would double every turn).
        if (shouldSignalReply(envelope, await readEntries(converse))) {
          const name = toProfile?.name ?? envelope.to;
          const wakeId =
            entry.originConversation ?? (await mainConversationId(owner, envelope.from));
          await wakeConversation(
            wakeId,
            `[reply from ${name} • re: ${envelope.id}]\n\n${name} finished their turn without sending a reply — if you need their answer, read the room with the room tool (room id: ${room.id}) and follow up with them. Otherwise conclude here for your owner.`,
          );
        }
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
        (candidate.owner ?? "") === owner &&
        candidate.envelope.at > hourAgo &&
        ((candidate.envelope.from === from && candidate.envelope.to === to) ||
          (candidate.envelope.from === to && candidate.envelope.to === from)),
    );
    if (between.length >= pairRate) {
      throw new InvalidInput({ reason: `pair rate limit reached (${pairRate}/hour)` });
    }
    if (origin === "tool") {
      // Ad-hoc exchanges don't run forever: each bot gets a fixed number of
      // sends per sibling (all topics combined), so back-and-forth converges.
      const inRoom = entries.filter(
        (candidate) =>
          (candidate.owner ?? "") === owner &&
          candidate.origin !== "human" &&
          candidate.origin !== "cron" &&
          candidate.envelope.from === from &&
          candidate.envelope.to === to,
      );
      if (inRoom.length >= ROOM_EXCHANGE_CAP) {
        throw new InvalidInput({
          reason:
            `pair exchange cap reached (${ROOM_EXCHANGE_CAP} messages to this sibling) — ` +
            "conclude the exchange here; if the owner needs more, they will re-brief you",
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
    origin: MailboxOrigin,
    originConversation: string | null,
  ): Promise<MailboxEntry> => {
    const entry: MailboxEntry = {
      envelope,
      status: "pending",
      retries: 0,
      deliveredAt: null,
      settledAt: null,
      error: null,
      owner,
      origin,
      originConversation,
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
      return admit(input.owner, envelope, topic, input.origin, input.originConversation ?? null);
    },
    deliverExternal: async (input) => {
      const sender = `external:${input.from.replace(/^external:/, "")}`;
      const chain = [...input.chain, sender];
      const topic = (input.topic ?? "").trim();
      await validate(input.owner, sender, input.to, chain, [], "external");
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
      return admit(input.owner, envelope, topic, "external", null);
    },
    transcriptOf: async (owner, room) => {
      const entries = await readEntries(converse);
      const nameOf = async (id: string): Promise<string> => {
        if (isExternal(id)) return id.replace(/^external:/, "");
        const profile = await profiles.get(owner, id);
        return profile?.name ?? id;
      };
      const inRoom = entries
        .filter(
          (candidate) =>
            (candidate.owner ?? "") === owner &&
            candidate.envelope.topic === room.topic &&
            room.participants.includes(candidate.envelope.from) &&
            room.participants.includes(candidate.envelope.to),
        )
        .sort((a, b) => a.envelope.at - b.envelope.at);
      return Promise.all(
        inRoom.map(async (candidate) => ({
          at: candidate.envelope.at,
          speaker: await nameOf(candidate.envelope.from),
          text: candidate.envelope.body,
          system: false,
        })),
      );
    },
    endpointOf: (owner, room, profileId) =>
      readEntries(converse).then((entries) => endpointOf(owner, room, profileId, entries)),
    budgetOf: async (owner, from, to) => {
      const entries = await readEntries(converse);
      const used = entries.filter(
        (candidate) =>
          (candidate.owner ?? "") === owner &&
          candidate.origin !== "human" &&
          candidate.origin !== "cron" &&
          candidate.envelope.from === from &&
          candidate.envelope.to === to,
      ).length;
      return { used, cap: ROOM_EXCHANGE_CAP };
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
