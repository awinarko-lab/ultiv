/**
 * The Memory seam (RFC 0001 §9): profile memory (an entity's own durable
 * facts) above owner memory (the user's cross-profile preferences). Write
 * authority is config, not goodwill: entities write about themselves; only
 * the owner-designated memory keeper (policies.memoryKeeper) writes owner
 * memory. Reads: an entity sees its own memory plus the owner store — never
 * a sibling's. Cross-thread recall resolves through here, never transcripts.
 *
 * v2 rides behind `ULTIV_MEMORY_V2` (default on): writes land in
 * `ultiv.mem.facts` and, while the 14-day mirror is on, also append a v1
 * record so a rollback still sees new facts. The v1 doc family and helpers
 * stay exported for the REST surfaces and the mirror; they are never cleared
 * by v2 code.
 */
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { InvalidInput, NotFound } from "@ultiv/core";
import type { FactKind, FactTrust, MemoryFact, MemoryRecord } from "@ultiv/contracts";
import type { ConverseService } from "../converse/converse.ts";
import type { ProfilesService } from "../profiles/profiles.ts";
import type { DecideService } from "../decide/decide.ts";
import type { GenerateService } from "../generate/generate.ts";
import { ensureMigrated } from "./migrate.ts";
import { writeFactV2, type WriteFactResult } from "./consolidate.ts";
import { coreService, type CoreService } from "./core.ts";
import {
  ArchiveDoc,
  CoreDoc,
  EpisodesDoc,
  FactsDoc,
  GraphDoc,
  LIMITS,
  MemoryDoc,
  flags,
  mirrorRecord,
  newFact,
  ownerKey,
  profileKey,
} from "./model.ts";
import { recall, type RecallResult } from "./recall.ts";

const run = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(effect) as Promise<A>;

export interface MemoryService {
  /** Append one record. Scope `owner` requires the writer to be the keeper. */
  readonly write: (input: {
    readonly owner: string;
    /** The writing profile; null = a human/REST write (always allowed). */
    readonly writer: string | null;
    readonly scope: "profile" | "owner";
    /** Target profile for profile scope. */
    readonly profileId?: string;
    readonly text: string;
    readonly tags?: readonly string[];
    /** Guard verdicts (write guard §3). Absent = human/REST: trust owner. */
    readonly trust?: FactTrust;
    readonly origin?: string;
    readonly conversation?: string | null;
  }) => Promise<MemoryRecord>;
  /** An entity's readable world: its own memory plus the owner store. */
  readonly recallFor: (owner: string, profileId: string, query?: string) => Promise<MemoryRecord[]>;
  /** Read one scope outright (REST surfaces). */
  readonly read: (
    owner: string,
    scope: "profile" | "owner",
    profileId?: string,
  ) => Promise<MemoryRecord[]>;
  readonly removeProfile: (owner: string, profileId: string) => Promise<number>;
  /** Remove one profile-scope record — the human's per-item delete. */
  readonly remove: (owner: string, profileId: string, recordId: string) => Promise<void>;
  /**
   * v2: migrate (lazily, once) and read a store's facts. With
   * `ULTIV_MEMORY_V2=off` this still migrates — the migration itself rides
   * the v2 seam's first access — so callers stay on one code path.
   */
  readonly readFacts: (owner: string, profileId: string | null) => Promise<readonly MemoryFact[]>;
  /**
   * v2 ranked recall over own + owner facts (never a sibling's). Empty query
   * returns the top facts by importance × recency; history stays behind
   * `includeHistory`.
   */
  readonly recallV2: (
    owner: string,
    profileId: string,
    opts?: {
      readonly query?: string;
      readonly includeHistory?: boolean;
      readonly limit?: number;
      readonly budgetTokens?: number;
    },
  ) => Promise<RecallResult>;
  /**
   * v2 consolidating write: extract → resolve → decide → apply in one
   * transaction (supersede/refine keep history), mirrored to v1. The tool
   * surface; `write` above stays the plain append for REST/v1.
   */
  readonly writeV2: (input: {
    readonly owner: string;
    readonly profileId: string | null;
    readonly scope: "profile" | "owner";
    readonly writer: string | null;
    readonly text: string;
    readonly tags?: readonly string[];
    readonly kind?: FactKind;
    readonly importance?: number;
    readonly basis?: "owner_said" | "observed" | "inferred";
    readonly replaces?: string | null;
    readonly validFrom?: number | null;
    readonly trust?: FactTrust;
    readonly origin?: string;
    readonly conversation?: string | null;
  }) => Promise<WriteFactResult>;
  /** The always-on core block: read/add/replace/remove with budgets. */
  readonly core: CoreService;
}

export const memoryService = (deps: {
  readonly converse: ConverseService;
  readonly profiles: ProfilesService;
  /** The extraction/decision models; absent ⇒ deterministic fallbacks. */
  readonly generate?: GenerateService;
  readonly decide?: DecideService;
}): MemoryService => {
  const { converse, profiles } = deps;

  const readStore = (key: string): Promise<MemoryRecord[]> =>
    run(converse.docs.snapshotKeyed(MemoryDoc, key)).then((store) => store?.records ?? []);

  const writeStore = (key: string, records: MemoryRecord[]): Promise<void> =>
    run(
      converse.docs.commit(async (tx) => {
        const draft = await tx.doc(MemoryDoc, key, { records: [] });
        draft.records = records;
      }),
    );

  const requireKeeper = async (owner: string, writer: string | null): Promise<void> => {
    // Only the designated keeper (or a human, writer null) writes owner memory.
    if (writer !== null) {
      const writerProfile = await profiles.get(owner, writer);
      if (writerProfile?.policies.memoryKeeper !== true) {
        throw new InvalidInput({
          reason: "only the designated memory keeper writes owner memory",
        });
      }
    }
  };

  /** The v2 add: one fact into `ultiv.mem.facts`, mirrored to v1 when on. */
  const addFactV2 = async (input: {
    readonly owner: string;
    readonly profileId: string | null;
    readonly scope: "profile" | "owner";
    readonly writer: string | null;
    readonly text: string;
    readonly tags?: readonly string[];
    /** Guard verdicts stamped onto the fact; defaults are the human/REST ones. */
    readonly trust?: FactTrust;
    readonly origin?: string;
    readonly conversation?: string | null;
  }): Promise<MemoryRecord> => {
    await ensureMigrated(deps, input.owner, input.profileId);
    const key =
      input.profileId === null ? ownerKey(input.owner) : profileKey(input.owner, input.profileId);
    const fact = newFact({
      id: randomUUID(),
      scope: input.scope,
      profile: input.profileId,
      text: input.text.slice(0, LIMITS.textChars),
      kind: "note",
      tags: input.tags ?? [],
      entities: [],
      triple: null,
      importance: 3,
      confidence: 0.7,
      trust:
        input.trust ??
        (input.scope === "owner" ? "owner" : input.writer === null ? "owner" : "self"),
      source: {
        via: input.writer === null ? "rest" : "tool",
        writer: input.writer,
        origin: input.origin ?? "owner",
        conversation: input.conversation ?? null,
        episode: null,
      },
      validFrom: Date.now(),
      supersedes: [],
      at: Date.now(),
    });
    await run(
      converse.docs.commit(async (tx) => {
        const facts = await tx.doc(FactsDoc, key, { facts: [], migratedAt: null });
        facts.facts = [...facts.facts, fact];
        if (flags.mirror()) {
          const legacy = await tx.doc(MemoryDoc, key, { records: [] });
          legacy.records = [...legacy.records, mirrorRecord(fact)].slice(-LIMITS.mirrorCap);
        }
      }),
    );
    return mirrorRecord(fact);
  };

  const service: MemoryService = {
    write: async (input) => {
      if (input.scope === "owner") {
        await requireKeeper(input.owner, input.writer);
        if (flags.v2()) {
          return addFactV2({
            ...input,
            profileId: null,
            ...(input.trust !== undefined ? { trust: input.trust } : {}),
            ...(input.origin !== undefined ? { origin: input.origin } : {}),
            ...(input.conversation !== undefined ? { conversation: input.conversation } : {}),
          });
        }
        const record: MemoryRecord = {
          id: randomUUID(),
          scope: input.scope,
          profile: null,
          text: input.text.slice(0, 4_000),
          tags: [...(input.tags ?? [])].slice(0, 12),
          at: Date.now(),
        };
        const records = await readStore(ownerKey(input.owner));
        await writeStore(ownerKey(input.owner), [...records, record].slice(-2_000));
        return record;
      }
      if (input.profileId === undefined) {
        throw new InvalidInput({ reason: "profileId is required for profile scope" });
      }
      const profileId: string = input.profileId;
      if (flags.v2()) {
        return addFactV2({
          owner: input.owner,
          writer: input.writer,
          scope: "profile",
          profileId,
          text: input.text,
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.trust !== undefined ? { trust: input.trust } : {}),
          ...(input.origin !== undefined ? { origin: input.origin } : {}),
          ...(input.conversation !== undefined ? { conversation: input.conversation } : {}),
        });
      }
      const record: MemoryRecord = {
        id: randomUUID(),
        scope: "profile",
        profile: input.profileId,
        text: input.text.slice(0, 4_000),
        tags: [...(input.tags ?? [])].slice(0, 12),
        at: Date.now(),
      };
      const key = profileKey(input.owner, input.profileId);
      const records = await readStore(key);
      await writeStore(key, [...records, record].slice(-2_000));
      return record;
    },
    recallFor: async (owner, profileId, query) => {
      if (flags.v2()) {
        const ranked = await service.recallV2(
          owner,
          profileId,
          query !== undefined ? { query } : {},
        );
        return ranked.facts.map((fact) => ({
          id: fact.id,
          scope: fact.scope,
          profile: fact.profile,
          text: fact.text,
          tags: fact.tags,
          at: fact.createdAt,
        }));
      }
      const [own, ownerStore] = await Promise.all([
        readStore(profileKey(owner, profileId)),
        readStore(ownerKey(owner)),
      ]);
      const all = [...own, ...ownerStore];
      if (query === undefined || query.trim() === "") return all.slice(-100).reverse();
      const needle = query.trim().toLowerCase();
      return all
        .filter(
          (record) =>
            record.text.toLowerCase().includes(needle) ||
            record.tags.some((tag) => tag.toLowerCase().includes(needle)),
        )
        .slice(-100)
        .reverse();
    },
    read: (owner, scope, profileId) =>
      scope === "owner"
        ? readStore(ownerKey(owner)).then((records) => records.slice(-500).reverse())
        : profileId !== undefined
          ? readStore(profileKey(owner, profileId)).then((records) => records.slice(-500).reverse())
          : Promise.resolve([]),
    removeProfile: async (owner, profileId) => {
      const records = await readStore(profileKey(owner, profileId));
      await writeStore(profileKey(owner, profileId), []);
      // v2 tiers clear with the store (purge cascade); the v1 doc too.
      await run(
        converse.docs.commit(async (tx) => {
          const facts = await tx.doc(FactsDoc, profileKey(owner, profileId), {
            facts: [],
            migratedAt: null,
          });
          facts.facts = [];
          facts.migratedAt = null;
          const graph = await tx.doc(GraphDoc, profileKey(owner, profileId), { entities: [] });
          graph.entities = [];
          const episodes = await tx.doc(EpisodesDoc, profileKey(owner, profileId), {
            episodes: [],
          });
          episodes.episodes = [];
          const core = await tx.doc(CoreDoc, profileKey(owner, profileId), {
            lines: [],
            seededAt: null,
          });
          core.lines = [];
        }),
      );
      return records.length;
    },
    remove: async (owner, profileId, recordId) => {
      const key = profileKey(owner, profileId);
      const records = await readStore(key);
      const next = records.filter((record) => record.id !== recordId);
      if (next.length === records.length) {
        throw new NotFound({ what: `memory record ${recordId}` });
      }
      await writeStore(key, next);
    },
    readFacts: async (owner, profileId) => {
      await ensureMigrated(deps, owner, profileId);
      const key = profileId === null ? ownerKey(owner) : profileKey(owner, profileId);
      return run(converse.docs.snapshotKeyed(FactsDoc, key)).then((store) => store?.facts ?? []);
    },
    recallV2: async (owner, profileId, opts = {}) => {
      // An entity recalls its own store plus the owner store — never a sibling's.
      const [own, ownerStore, entities] = await Promise.all([
        service.readFacts(owner, profileId),
        service.readFacts(owner, null),
        run(converse.docs.snapshotKeyed(GraphDoc, profileKey(owner, profileId))).then(
          (store) => store?.entities ?? [],
        ),
      ]);
      const rankOne = (facts: readonly MemoryFact[]) =>
        recall({
          facts,
          entities,
          ...(opts.query !== undefined ? { query: opts.query } : {}),
          ...(opts.includeHistory !== undefined ? { includeHistory: opts.includeHistory } : {}),
          ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
          ...(opts.budgetTokens !== undefined ? { budgetTokens: opts.budgetTokens } : {}),
        });
      const merged = [rankOne(own), rankOne(ownerStore)];
      return {
        core: [],
        facts: merged.flatMap((entry) => entry.facts).slice(0, opts.limit ?? 10),
        lines: merged.flatMap((entry) => entry.lines),
        tokens: merged.reduce((sum, entry) => sum + entry.tokens, 0),
      };
    },
    writeV2: async (input) => {
      if (input.scope === "owner") await requireKeeper(input.owner, input.writer);
      await ensureMigrated(deps, input.owner, input.profileId);
      return writeFactV2(deps, (owner, profileId) => service.readFacts(owner, profileId), input);
    },
    core: coreService({ converse, profiles }),
  };
  return service;
};

export { MemoryDoc, ownerKey as memoryOwnerKey, profileKey as memoryProfileKey } from "./model.ts";
