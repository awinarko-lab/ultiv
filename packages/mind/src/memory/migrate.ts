/**
 * Lazy, per-store, zero-loss v1 → v2 migration. On the first v2 access to a
 * store it converts the flat `ultiv.memory` list into `ultiv.mem.facts` in
 * ONE transaction that re-reads both docs inside the lock. Ids, text and tags
 * are kept (`at` becomes `createdAt`); defaults: importance 3, confidence
 * 0.7, status current, trust self (owner for the owner store), kind note.
 * Entities are linked deterministically later (tidy backfill) — never a model
 * call here. Nothing is deduplicated; duplicates become tidy proposals.
 * Every converted fact is verified against its v1 source (id, text, hash)
 * before the transaction commits; a mismatch aborts it and the store keeps
 * serving v1.
 */
import { InvalidInput } from "@ultiv/core";
import type { MemoryFact } from "@ultiv/contracts";
import type { ConverseService } from "../converse/converse.ts";
import { FactsDoc, LIMITS, MemoryDoc, factHash, newFact, ownerKey, profileKey } from "./model.ts";

/** The default-stamped v2 fact for one v1 record (deterministic, no model). */
const toFact = (record: {
  id: string;
  scope: "profile" | "owner";
  profile: string | null;
  text: string;
  tags: readonly string[];
  at: number;
}): MemoryFact =>
  newFact({
    id: record.id,
    scope: record.scope,
    profile: record.profile,
    text: record.text,
    kind: "note",
    tags: record.tags,
    entities: [],
    triple: null,
    importance: 3,
    confidence: 0.7,
    trust: record.scope === "owner" ? "owner" : "self",
    source: { via: "migration", writer: null, origin: "owner", conversation: null, episode: null },
    validFrom: record.at,
    supersedes: [],
    at: record.at,
  });

/**
 * Ensure a store's v2 facts doc exists and mirrors the v1 list. Idempotent:
 * a store that already migrated is returned untouched. Throws on any
 * verification mismatch so the transaction rolls back and v1 keeps serving.
 */
export const ensureMigrated = async (
  deps: { readonly converse: ConverseService },
  owner: string,
  profileId: string | null,
): Promise<void> => {
  const key = profileId === null ? ownerKey(owner) : profileKey(owner, profileId);
  await deps.converse.docs.commit(async (tx) => {
    const facts = await tx.doc(FactsDoc, key, { facts: [], migratedAt: null });
    if (facts.migratedAt !== null) return;
    const legacy = await tx.doc(MemoryDoc, key, { records: [] });
    const converted = legacy.records.map(toFact);
    if (converted.length !== legacy.records.length) {
      throw new InvalidInput({ reason: "memory migration: record count mismatch" });
    }
    const byId = new Map(legacy.records.map((record) => [record.id, record]));
    for (const fact of converted) {
      const source = byId.get(fact.id);
      const expected = source === undefined ? "" : source.text.slice(0, LIMITS.textChars);
      if (source === undefined || fact.text !== expected || fact.hash !== factHash(expected)) {
        throw new InvalidInput({ reason: `memory migration: fact ${fact.id} failed verification` });
      }
    }
    facts.facts = converted;
    facts.migratedAt = Date.now();
  });
};
