/**
 * The durable state plane: a profile-scoped key-value store the entity can
 * rely on ACROSS sessions and wakes. This is the answer to "a Routine's
 * dedup ledger empties silently" — state written here survives restarts,
 * sessions and purges-of-nothing, because it lives in a durable doc family
 * (`ultiv.kv.<profile>`), not in a session workspace. The semantic rule it
 * cannot lift: missing state still has two causes (never written vs lost),
 * so callers write generation markers for anything whose absence must be
 * distinguishable.
 */
import { defineDoc } from "@earendil-works/pi-durable";
import { Effect } from "effect";
import type { ConverseService } from "../converse/converse.ts";

export type KvEntry = {
  readonly value: string;
  readonly updatedAt: number;
};

export type KvState = {
  readonly items: Record<string, KvEntry>;
};

/** One doc per profile: small, whole-doc, checkpointed on every change. */
export const kvDoc = (profile: string) =>
  defineDoc<KvState>({
    kind: `ultiv.kv.${profile}`,
    version: 1,
    scope: "session",
    initial: () => ({ items: {} }),
    checkpointWhen: () => true,
  });

export interface KvService {
  /** Read one key; undefined when unset (NOT proof the write never happened). */
  readonly get: (profile: string, key: string) => Promise<string | undefined>;
  readonly set: (profile: string, key: string, value: string) => Promise<void>;
  readonly delete: (profile: string, key: string) => Promise<boolean>;
  /** Every key with metadata, oldest-writes first. */
  readonly list: (
    profile: string,
  ) => Promise<readonly { key: string; value: string; updatedAt: number }[]>;
}

export const kvService = (deps: { readonly converse: ConverseService }): KvService => {
  const readItems = async (profile: string): Promise<Record<string, KvEntry>> =>
    (await Effect.runPromise(deps.converse.docs.snapshot(kvDoc(profile))))?.items ?? {};

  return {
    get: async (profile, key) => (await readItems(profile))[key]?.value,
    set: async (profile, key, value) => {
      await Effect.runPromise(
        deps.converse.docs.commit(async (tx) => {
          const draft = await tx.doc(kvDoc(profile));
          draft.items = { ...draft.items, [key]: { value, updatedAt: Date.now() } };
        }),
      );
    },
    delete: async (profile, key) => {
      const items = await readItems(profile);
      if (items[key] === undefined) return false;
      await Effect.runPromise(
        deps.converse.docs.commit(async (tx) => {
          const draft = await tx.doc(kvDoc(profile));
          const { [key]: _removed, ...rest } = draft.items;
          draft.items = rest;
        }),
      );
      return true;
    },
    list: async (profile) =>
      Object.entries(await readItems(profile))
        .map(([key, entry]) => ({ key, value: entry.value, updatedAt: entry.updatedAt }))
        .sort((a, b) => a.updatedAt - b.updatedAt),
  };
};
