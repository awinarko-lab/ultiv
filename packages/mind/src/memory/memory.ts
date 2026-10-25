/**
 * The Memory seam (RFC 0001 §9): profile memory (an entity's own durable
 * facts) above owner memory (the user's cross-profile preferences). Write
 * authority is config, not goodwill: entities write about themselves; only
 * the owner-designated memory keeper (policies.memoryKeeper) writes owner
 * memory. Reads: an entity sees its own memory plus the owner store — never
 * a sibling's. Cross-thread recall resolves through here, never transcripts.
 */
import { randomUUID } from "node:crypto";
import { defineDocFamily } from "@earendil-works/pi-durable";
import { Effect } from "effect";
import { InvalidInput } from "@ultiv/core";
import type { MemoryRecord } from "@ultiv/contracts";
import type { ConverseService } from "../converse/converse.ts";
import type { ProfilesService } from "../profiles/profiles.ts";

/** The store's shape — a type alias, so it satisfies the doc family's JsonObject. */
type MemoryStore = { records: MemoryRecord[] };

const MemoryDoc = defineDocFamily<MemoryStore, MemoryStore>({
	kind: "ultiv.memory",
	version: 1,
	scope: "session",
	family: true,
	initial: (seed) => seed,
	checkpointWhen: () => true,
});

const ownerKey = (owner: string): string => `owner:${owner}`;
const profileKey = (owner: string, profileId: string): string => `profile:${owner}:${profileId}`;

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
}

export const memoryService = (deps: {
	readonly converse: ConverseService;
	readonly profiles: ProfilesService;
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

	const service: MemoryService = {
		write: async (input) => {
			const record: MemoryRecord = {
				id: randomUUID(),
				scope: input.scope,
				profile: input.scope === "profile" ? (input.profileId ?? null) : null,
				text: input.text.slice(0, 4_000),
				tags: [...(input.tags ?? [])].slice(0, 12),
				at: Date.now(),
			};
			if (input.scope === "owner") {
				// Only the designated keeper (or a human, writer null) writes owner memory.
				if (input.writer !== null) {
					const writer = await profiles.get(input.owner, input.writer);
					if (writer?.policies.memoryKeeper !== true) {
						throw new InvalidInput({ reason: "only the designated memory keeper writes owner memory" });
					}
				}
				const records = await readStore(ownerKey(input.owner));
				await writeStore(ownerKey(input.owner), [...records, record].slice(-2_000));
				return record;
			}
			if (input.profileId === undefined) {
				throw new InvalidInput({ reason: "profileId is required for profile scope" });
			}
			const key = profileKey(input.owner, input.profileId);
			const records = await readStore(key);
			await writeStore(key, [...records, record].slice(-2_000));
			return record;
		},
		recallFor: async (owner, profileId, query) => {
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
		removeProfile: (owner, profileId) =>
			readStore(profileKey(owner, profileId)).then(async (records) => {
				await writeStore(profileKey(owner, profileId), []);
				return records.length;
			}),
	};
	return service;
};

export { MemoryDoc, ownerKey as memoryOwnerKey, profileKey as memoryProfileKey };
