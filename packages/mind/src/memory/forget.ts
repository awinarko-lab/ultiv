/**
 * Tombstones and history: `memory_forget` marks a fact forgotten (a
 * restorable tombstone — the text survives until the owner runs Purge), and
 * `memory_history` walks a fact's version chain (validity, change type,
 * source). Own writable scope only: a bot forgets its own facts; owner-trust
 * facts only when the owner asked in that very turn.
 */
import { Effect } from "effect";
import { InvalidInput, NotFound } from "@ultiv/core";
import type { MemoryFact } from "@ultiv/contracts";
import type { AuditService } from "../audit/audit.ts";
import type { ConverseService } from "../converse/converse.ts";
import { FactsDoc, ownerKey, profileKey } from "./model.ts";
import { contextOf, type WriteContext } from "./guard.ts";
import type { ProfilesService } from "../profiles/profiles.ts";

const run = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(effect) as Promise<A>;

export interface ForgetHistoryDeps {
  readonly converse: ConverseService;
  readonly profiles: ProfilesService;
  readonly guard: {
    readonly audit?: AuditService;
    readonly untrustedTool?: (name: string) => boolean;
  };
}

export interface ForgetResult {
  readonly id: string;
  readonly restored: false;
}

export const forgetFact = async (
  deps: ForgetHistoryDeps,
  owner: string,
  profileId: string,
  factId: string,
  reason: string,
  conversationId: string | null,
): Promise<ForgetResult> => {
  const key = profileKey(owner, profileId);
  const ownerKeyStr = ownerKey(owner);
  let target: MemoryFact | undefined;
  let targetKey: string | null = null;
  for (const keyCandidate of [key, ownerKeyStr]) {
    const facts = await run(deps.converse.docs.snapshotKeyed(FactsDoc, keyCandidate)).then(
      (store) => store?.facts ?? [],
    );
    const found = facts.find((fact) => fact.id === factId);
    if (found !== undefined) {
      target = found;
      targetKey = keyCandidate;
      break;
    }
  }
  if (target === undefined || targetKey === null) {
    throw new NotFound({ what: `fact ${factId}` });
  }
  // Authority: a bot forgets facts from its OWN store (or its own writes in
  // the owner store); owner-trust facts only when the owner asked this turn.
  const isOwnStore = targetKey === key;
  const context: WriteContext | null =
    conversationId === null
      ? null
      : await contextOf({ converse: deps.converse, ...deps.guard }, conversationId).catch(
          () => null,
        );
  if (!isOwnStore && target.trust === "owner") {
    if (context === null || context.origin !== "owner") {
      throw new InvalidInput({
        reason: "owner-stated facts are forgotten only when the owner asked in this turn",
      });
    }
  }
  await run(
    deps.converse.docs.commit(async (tx) => {
      const facts = await tx.doc(FactsDoc, targetKey, { facts: [], migratedAt: null });
      facts.facts = facts.facts.map((fact) =>
        fact.id === factId
          ? { ...fact, status: "forgotten" as const, expiredAt: Date.now() }
          : fact,
      );
    }),
  );
  void reason;
  return { id: factId, restored: false };
};

export interface HistoryEntry {
  readonly id: string;
  readonly text: string;
  readonly status: MemoryFact["status"];
  /** World-time validity, change type and source for one version. */
  readonly validFrom: number | null;
  readonly validTo: number | null;
  readonly change: "created" | "superseded" | "refined" | "forgotten";
  readonly source: MemoryFact["source"];
  readonly supersededBy: string | null;
}

/** Walk one fact's version chain: the fact, its ancestors, its successors. */
export const historyOf = async (
  deps: { readonly converse: ConverseService },
  owner: string,
  profileId: string | null,
  factId: string,
): Promise<readonly HistoryEntry[]> => {
  const key = profileId === null ? ownerKey(owner) : profileKey(owner, profileId);
  const facts = await run(deps.converse.docs.snapshotKeyed(FactsDoc, key)).then(
    (store) => store?.facts ?? [],
  );
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const anchor = byId.get(factId);
  if (anchor === undefined) throw new NotFound({ what: `fact ${factId}` });
  // Ancestors: follow supersedes links down; successors: supersededBy up.
  const chain: MemoryFact[] = [anchor];
  let cursor: MemoryFact | undefined = anchor;
  while (cursor !== undefined && cursor.supersedes.length > 0) {
    const prev = byId.get(cursor.supersedes[0] ?? "");
    if (prev === undefined) break;
    chain.unshift(prev);
    cursor = prev;
  }
  cursor = anchor;
  const seen = new Set([anchor.id]);
  while (cursor !== undefined && cursor.supersededBy !== null && !seen.has(cursor.supersededBy)) {
    const next = byId.get(cursor.supersededBy);
    if (next === undefined) break;
    seen.add(next.id);
    chain.push(next);
    cursor = next;
  }
  return chain.map((fact, index) => ({
    id: fact.id,
    text: fact.text,
    status: fact.status,
    validFrom: fact.validFrom,
    validTo: fact.validTo,
    change:
      fact.status === "forgotten"
        ? "forgotten"
        : index === 0
          ? "created"
          : factHashSimilar(chain[index - 1] ?? fact, fact)
            ? "refined"
            : "superseded",
    source: fact.source,
    supersededBy: fact.supersededBy,
  }));
};

const factHashSimilar = (older: MemoryFact, newer: MemoryFact): boolean =>
  older.hash === newer.hash ||
  (older.text.length > 0 &&
    newer.text.startsWith(older.text.slice(0, Math.min(40, older.text.length))));

/** Restore a forgotten tombstone (the owner's undo). */
export const restoreFact = async (
  deps: { readonly converse: ConverseService },
  owner: string,
  profileId: string | null,
  factId: string,
): Promise<void> => {
  const key = profileId === null ? ownerKey(owner) : profileKey(owner, profileId);
  await run(
    deps.converse.docs.commit(async (tx) => {
      const facts = await tx.doc(FactsDoc, key, { facts: [], migratedAt: null });
      facts.facts = facts.facts.map((fact) =>
        fact.id === factId && fact.status === "forgotten"
          ? { ...fact, status: "current" as const, expiredAt: null }
          : fact,
      );
    }),
  );
};

/** Purge: the OWNER's irreversible delete of forgotten facts' text. */
export const purgeForgotten = async (
  deps: { readonly converse: ConverseService },
  owner: string,
  profileId: string | null,
): Promise<number> => {
  const key = profileId === null ? ownerKey(owner) : profileKey(owner, profileId);
  return run(
    deps.converse.docs.commit<number>(async (tx) => {
      const facts = await tx.doc(FactsDoc, key, { facts: [], migratedAt: null });
      let purged = 0;
      // The tombstone keeps id, dates and links; the text is gone for good.
      facts.facts = facts.facts.map((fact) => {
        if (fact.status !== "forgotten") return fact;
        if (fact.text !== "") purged += 1;
        return { ...fact, text: "", tags: [], triple: null, hash: "" };
      });
      return purged;
    }),
  );
};
