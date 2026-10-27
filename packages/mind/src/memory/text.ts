/**
 * Bilingual (EN + ID) text analysis: normalization, tokenization, light
 * stemming and concept folding. Indexing and queries both run through here,
 * so "kucing" finds "cat": every synonym-group term carries its shared
 * §concept token on both sides.
 */
import { CONCEPT_OF } from "./lexicon.ts";
import { isStopWord } from "./stopwords.ts";

/** NFKD, strip diacritics, lowercase, fold the English possessive 's. */
export const normalize = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/'s\b/g, "");

const WORD_RE = /[a-z0-9]+/g;

/** English light stemming: -s/-es/-ies/-ing/-ed, guarded by length. */
const stemEn = (word: string): string => {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && (word.endsWith("ing") || word.endsWith("ed"))) return word.slice(0, -3);
  if (word.length > 3 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
};

const ID_SUFFIXES = ["nya", "lah", "kah", "ku", "mu", "kan", "an", "i"] as const;
const ID_PREFIXES = ["me", "ber", "di", "ter", "ke", "se", "pe", "per"] as const;

/** Indonesian light stemming: at most one suffix, then one prefix. */
const stemId = (word: string): string => {
  let stem = word;
  for (const suffix of ID_SUFFIXES) {
    if (stem.length > suffix.length + 2 && stem.endsWith(suffix)) {
      stem = stem.slice(0, -suffix.length);
      break;
    }
  }
  for (const prefix of ID_PREFIXES) {
    if (stem.length > prefix.length + 2 && stem.startsWith(prefix)) {
      stem = stem.slice(prefix.length);
      break;
    }
  }
  return stem;
};

/**
 * One analysis token: the (possibly stemmed) surface form plus the concept
 * token when the term (or a phrase in the text) folds into a group.
 */
export interface AnalyzedToken {
  readonly term: string;
  /** A §concept token when the surface folds into a synonym group. */
  readonly concept: string | null;
}

/**
 * Analyze text into retrieval tokens. Stop words drop; remaining words are
 * stemmed (EN and ID candidates both tried, the shorter stem wins when legal)
 * and, when they belong to a synonym group, carry their §concept token.
 */
export const analyze = (text: string): readonly AnalyzedToken[] => {
  const normalized = normalize(text);
  const words = normalized.match(WORD_RE) ?? [];
  const tokens: AnalyzedToken[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? "";
    if (word.length < 2 || isStopWord(word)) continue;
    // Multi-word concept phrases (e.g. "ulang tahun") fold bigram-wise.
    const bigram = `${word} ${words[i + 1] ?? ""}`.trim();
    const phraseConcept = words[i + 1] !== undefined ? CONCEPT_OF.get(bigram) : undefined;
    const stem = pickStem(word);
    tokens.push({ term: stem, concept: CONCEPT_OF.get(word) ?? CONCEPT_OF.get(stem) ?? null });
    if (phraseConcept !== undefined) {
      tokens.push({ term: bigram, concept: phraseConcept });
      i += 1;
    }
  }
  return tokens;
};

/** The shorter legal stem wins; when EN and ID disagree, prefer EN. */
const pickStem = (word: string): string => {
  const en = stemEn(word);
  const id = stemId(word);
  const shortest = en.length <= id.length ? en : id;
  return shortest.length >= 2 ? shortest : word;
};

/** Query-side terms: analysis terms plus each §concept at its own weight. */
export const queryTerms = (query: string): readonly { term: string; weight: number }[] => {
  const tokens = analyze(query);
  const seen = new Map<string, number>();
  for (const token of tokens) {
    seen.set(token.term, Math.max(seen.get(token.term) ?? 0, 1));
    if (token.concept !== null) {
      seen.set(token.concept, Math.max(seen.get(token.concept) ?? 0, 0.8));
    }
  }
  return [...seen].map(([term, weight]) => ({ term, weight }));
};

/** Index-side terms: analysis terms plus their §concepts at full weight. */
export const indexTerms = (text: string): readonly string[] => {
  const tokens = analyze(text);
  const terms = new Set<string>();
  for (const token of tokens) {
    terms.add(token.term);
    if (token.concept !== null) terms.add(token.concept);
  }
  return [...terms];
};
