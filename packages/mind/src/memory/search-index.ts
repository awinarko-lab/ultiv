/**
 * The in-process search index behind ranked recall. Per scope, cached by the
 * store's signature (fact ids + count), and behind the `MemoryIndex`
 * interface so an SQLite FTS5 sidecar can replace it past ~20k facts.
 * Ranking is BM25 (k1 1.2, b 0.75) over boosted fields: text ×1, tags ×2,
 * entity names ×2.
 */
import { indexTerms } from "./text.ts";

export interface MemoryIndex {
  /** BM25 scores for one query's terms ({term, weight}). */
  readonly search: (
    terms: readonly { readonly term: string; readonly weight: number }[],
  ) => readonly { readonly id: string; readonly score: number }[];
}

interface Posting {
  readonly id: string;
  /** Term frequency in weighted-field units. */
  readonly tf: number;
}

interface BuiltIndex extends MemoryIndex {
  /** Cheap signature guard for the cache. */
  readonly signature: string;
}

const K1 = 1.2;
const B = 0.75;

const fieldTerms = (text: string, weight: number, into: Map<string, number>): void => {
  for (const term of indexTerms(text)) {
    into.set(term, (into.get(term) ?? 0) + weight);
  }
};

/**
 * Build the index over facts. `namesOf` resolves a fact's entity ids to the
 * searchable names/aliases known at build time (the graph may be empty).
 */
export const buildIndex = (
  facts: readonly {
    readonly id: string;
    readonly text: string;
    readonly tags: readonly string[];
    readonly entities: readonly string[];
  }[],
  namesOf: (entityId: string) => readonly string[],
): BuiltIndex => {
  const postings = new Map<string, Posting[]>();
  const lengths = new Map<string, number>();
  let totalLength = 0;
  for (const fact of facts) {
    const fields = new Map<string, number>();
    fieldTerms(fact.text, 1, fields);
    for (const tag of fact.tags) fieldTerms(tag, 2, fields);
    for (const entityId of fact.entities) {
      for (const name of namesOf(entityId)) fieldTerms(name, 2, fields);
    }
    let length = 0;
    for (const [term, tf] of fields) {
      length += tf;
      const list = postings.get(term) ?? [];
      list.push({ id: fact.id, tf });
      postings.set(term, list);
    }
    lengths.set(fact.id, length);
    totalLength += length;
  }
  const n = facts.length;
  const avgLength = n === 0 ? 1 : totalLength / n;
  const df = (term: string): number => postings.get(term)?.length ?? 0;
  const idf = (term: string): number => Math.log(1 + (n - df(term) + 0.5) / (df(term) + 0.5));
  return {
    signature: `${n}:${facts.map((fact) => fact.id).join(",")}`,
    search: (terms) => {
      const scores = new Map<string, number>();
      for (const { term, weight } of terms) {
        const list = postings.get(term);
        if (list === undefined) continue;
        const termIdf = idf(term);
        for (const { id, tf } of list) {
          const docLength = lengths.get(id) ?? 1;
          const norm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (docLength / avgLength)));
          scores.set(id, (scores.get(id) ?? 0) + weight * termIdf * norm);
        }
      }
      return [...scores].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
    },
  };
};

/** The per-scope index cache. Keys are store keys; values carry signatures. */
const cache = new Map<string, BuiltIndex>();

export const cachedIndex = (
  key: string,
  facts: Parameters<typeof buildIndex>[0],
  namesOf: (entityId: string) => readonly string[],
  signature: string,
): MemoryIndex => {
  const existing = cache.get(key);
  if (existing !== undefined && existing.signature === signature) return existing;
  const built = buildIndex(facts, namesOf);
  cache.set(key, built);
  return built;
};

/** Test seam: drop the whole cache (a scope set can change under a key). */
export const resetIndexCache = (): void => cache.clear();
