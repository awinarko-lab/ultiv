/**
 * The Profiles faculty: user-defined AI entities above sessions. One runtime,
 * one entity per profile — each profile owns its main chat ("Bot Mode"),
 * sessions, per-pair DM threads, artifacts scope and persona. The service owns
 * the conversation→profile index that persona rendering, audit stamping and
 * the artifact scope resolver all read; docs and pure helpers live in docs.ts.
 */
import { randomUUID } from "node:crypto";
import type { AgentChange } from "@earendil-works/pi-durable";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { Effect } from "effect";
import { InvalidInput, NotFound } from "@ultiv/core";
import type { ProfileCreate, ProfileInfo, SessionInfo } from "@ultiv/contracts";
import { KENARI_MODELS } from "../providers/kenari.ts";
import { TasksDoc, taskConversationKey } from "../tasks/tasks.ts";
import type { ConverseService } from "../converse/converse.ts";
import type { GenerateService } from "../generate/generate.ts";
import {
  MAIN_PREFIX,
  SettingsDoc,
  commitProfiles,
  commitSessions,
  defaultPolicies,
  defaultTimezone,
  legacyKey,
  pairKey,
  readProfiles,
  readSessions,
  scopedKey,
  titleFor,
  validTimezone,
} from "./docs.ts";
import type { ConversationScope } from "./docs.ts";

export {
  MAIN_PREFIX,
  ProfilesDoc,
  SessionsDoc,
  defaultPolicies,
  defaultTimezone,
  legacyKey,
  pairKey,
  pairSessionId,
  scopedKey,
} from "./docs.ts";
export type { ConversationScope } from "./docs.ts";

export interface ProfilesService {
  readonly list: (owner: string) => Promise<ProfileInfo[]>;
  readonly get: (owner: string, id: string) => Promise<ProfileInfo | undefined>;
  readonly create: (owner: string, input: ProfileCreate) => Promise<ProfileInfo>;
  readonly update: (
    owner: string,
    id: string,
    patch: Partial<ProfileCreate>,
  ) => Promise<ProfileInfo>;
  readonly setArchived: (owner: string, id: string, archived: boolean) => Promise<ProfileInfo>;
  /** Remove the profile row and its session rows; returns them for the cascade. */
  readonly remove: (owner: string, id: string) => Promise<SessionInfo[]>;
  readonly ensureDefault: (owner: string) => Promise<ProfileInfo>;
  /** Bot Mode: the profile's persistent main chat (created lazily, rotated on reset). */
  readonly ensureMain: (owner: string, profileId: string) => Promise<SessionInfo>;
  readonly resetMain: (owner: string, profileId: string) => Promise<SessionInfo>;
  readonly createSession: (
    owner: string,
    profileId: string,
    title: string | null,
  ) => Promise<SessionInfo>;
  readonly listSessions: (owner: string, profileId?: string) => Promise<SessionInfo[]>;
  readonly removeSession: (owner: string, id: string) => Promise<boolean>;
  readonly touchSession: (
    owner: string,
    chatId: string,
    info: { at: number; titleSeed?: string },
  ) => Promise<void>;
  /** The registry row for a session id, any profile of any owner. */
  readonly rowOf: (id: string) => Promise<SessionInfo | undefined>;
  /** The conversation key a session row resolves to (legacy-aware). */
  readonly keyOfRow: (row: SessionInfo) => Promise<string>;
  /** Key for an id under an owner: registered row, else the default profile scope. */
  readonly keyForSession: (owner: string, id: string) => Promise<string>;
  /**
   * Adopt a conversation into a profile's scope (rooms use this): ensure the
   * key, index it for persona/audit/memory/artifact scoping.
   */
  readonly adoptConversation: (
    key: string,
    scope: {
      readonly owner: string;
      readonly profileId: string;
      readonly kind: SessionInfo["kind"];
      readonly participants: readonly string[] | null;
    },
  ) => Promise<void>;
  /** The owner's main bot — the default surface; exactly one at a time. */
  readonly mainOf: (owner: string) => Promise<string>;
  readonly setMain: (owner: string, profileId: string) => Promise<void>;
  /** The conversation scope index: persona, audit and artifact scoping read this. */
  readonly scopeOf: (conversationId: string) => ConversationScope | undefined;
  readonly profileOf: (conversationId: string) => ProfileInfo | undefined;
  /** The agent a profile's new conversations start with (model default + allowlist). */
  readonly agentFor: (profile: ProfileInfo) => AgentChange;
}

const run = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(effect) as Promise<A>;

export const profilesService = (deps: {
  readonly converse: ConverseService;
  readonly generate: GenerateService;
  /** The act's tool registrations, for per-profile allowlists. */
  readonly tools: () => readonly { readonly name: string }[];
}): ProfilesService => {
  const { converse, generate } = deps;
  const scopeIndex = new Map<string, ConversationScope>();
  const profileByConversation = new Map<string, ProfileInfo>();
  let indexBuilt: Promise<void> | undefined;

  const rebuildIndex = async (): Promise<void> => {
    const [rows, profiles, tasks] = await Promise.all([
      run(readSessions(converse)),
      run(readProfiles(converse)),
      run(converse.docs.snapshot(TasksDoc)),
    ]);
    const scopeOfRow = (row: SessionInfo): ConversationScope => ({
      owner: row.owner,
      profileId: row.profile,
      kind: row.kind,
      participants: row.participants,
    });
    for (const row of rows) {
      const key =
        row.kind === "dm" && row.participants !== null
          ? pairKey(row.owner, row.participants[0] ?? "", row.participants[1] ?? "")
          : await keyOfRowImpl(row);
      const cid = await run(converse.conversationIdOf(key));
      if (cid !== undefined) {
        scopeIndex.set(String(cid), scopeOfRow(row));
        const profile = profiles.find(
          (candidate) => candidate.owner === row.owner && candidate.id === row.profile,
        );
        if (profile !== undefined) profileByConversation.set(String(cid), profile);
      }
    }
    // Task conversations inherit the parent session's profile.
    for (const task of tasks?.tasks ?? []) {
      const cid = await run(converse.conversationIdOf(taskConversationKey(task.id)));
      const parent = rows.find((row) => row.id === task.sessionId);
      if (cid !== undefined && parent !== undefined) {
        scopeIndex.set(String(cid), {
          owner: parent.owner,
          profileId: parent.profile,
          kind: "session",
          participants: null,
        });
      }
    }
  };

  const ensureIndex = async (): Promise<void> => {
    indexBuilt ??= rebuildIndex();
    await indexBuilt;
  };

  const keyOfRowImpl = async (row: SessionInfo): Promise<string> => {
    const scoped =
      row.kind === "dm" && row.participants !== null
        ? pairKey(row.owner, row.participants[0] ?? "", row.participants[1] ?? "")
        : scopedKey(row.owner, row.profile, row.id);
    const mapped = await run(converse.conversationIdOf(scoped));
    if (mapped !== undefined) return scoped;
    // Pre-profile conversations keep their `owner:id` mapping; resolved keys
    // must follow the data, not the new format.
    if (row.profile === "default" && row.kind === "session") {
      const legacy = legacyKey(row.owner, row.id);
      const legacyMapped = await run(converse.conversationIdOf(legacy));
      if (legacyMapped !== undefined) return legacy;
    }
    return scoped;
  };

  const ensureConversationFor = async (
    key: string,
    profile: ProfileInfo,
    scope: ConversationScope,
  ) => {
    const change = service.agentFor(profile);
    const hasOverride = change.model !== undefined || change.tools !== undefined;
    await run(converse.ensure(key, hasOverride ? change : undefined));
    const cid = await run(converse.conversationIdOf(key));
    if (cid !== undefined) {
      profileByConversation.set(String(cid), profile);
      scopeIndex.set(String(cid), scope);
    }
  };

  const ensureProfileRow = async (owner: string, profileId: string): Promise<ProfileInfo> => {
    if (profileId === "default") {
      const existing = await service.get(owner, "default");
      if (existing !== undefined) return existing;
      // First touch by a brand-new owner materializes the substrate bot; an
      // owner who deleted it gets NotFound, not a resurrection.
      const owned = await run(readProfiles(converse)).then((rows) =>
        rows.filter((p) => p.owner === owner),
      );
      if (owned.length === 0) return service.ensureDefault(owner);
    }
    const profile = await service.get(owner, profileId);
    if (profile === undefined) throw new NotFound({ what: `profile ${profileId}` });
    return profile;
  };

  /** The spawn-time first turn, from the provided identity details. */
  const onboard = async (owner: string, profile: ProfileInfo): Promise<void> => {
    try {
      const main = await service.ensureMain(owner, profile.id);
      const key = scopedKey(owner, profile.id, main.id);
      const conversation = await run(converse.ensure(key));
      const description = profile.description !== "" ? `\n\nYour role: ${profile.description}` : "";
      const persona =
        profile.persona !== ""
          ? `\n\nYour identity and persona, as the owner wrote it:\n${profile.persona}`
          : "\n\nNo persona was provided yet; the owner will shape you over time.";
      const submission = await run(
        converse.submit(
          conversation,
          `[onboarding] You are ${profile.name} — a new bot in this workspace, created by the ` +
            `owner just now.${description}${persona}\n\nIntroduce yourself in one or two lines ` +
            `(who you are, what you are for), then stand by. Use no tools for this.`,
        ),
      );
      void run(converse.settle(conversation, submission)).catch(() => undefined);
    } catch {
      // Admission is best-effort at spawn time; creation itself never fails.
    }
  };

  /**
   * Single-flight per (owner, profile): onboarding's spawn-time ensureMain
   * races the caller's — concurrent creation must yield ONE main chat.
   */
  const mainInFlight = new Map<string, Promise<SessionInfo>>();
  const ensureMainOnce = async (owner: string, profileId: string): Promise<SessionInfo> => {
    await ensureProfileRow(owner, profileId);
    const rows = await run(readSessions(converse));
    const existing = rows.find(
      (row) => row.owner === owner && row.profile === profileId && row.kind === "main",
    );
    if (existing !== undefined) return existing;
    const profile = await ensureProfileRow(owner, profileId);
    const row: SessionInfo = {
      id: `${MAIN_PREFIX}${randomUUID().slice(0, 8)}`,
      owner,
      profile: profileId,
      kind: "main",
      participants: null,
      title: profile.name,
      createdAt: Date.now(),
      lastMessageAt: Date.now(),
    };
    await run(commitSessions(converse, (sessions) => [...sessions, row]));
    await ensureConversationFor(scopedKey(owner, profileId, row.id), profile, {
      owner,
      profileId,
      kind: "main",
      participants: null,
    });
    return row;
  };

  const service: ProfilesService = {
    list: async (owner) => {
      // Materialize the default bot only for a brand-new owner; after a
      // deliberate deletion it must NOT resurrect on every list.
      const rows = await run(readProfiles(converse)).then((all) =>
        all.filter((p) => p.owner === owner),
      );
      if (rows.length === 0) return [await service.ensureDefault(owner)];
      return rows;
    },
    get: (owner, id) =>
      run(readProfiles(converse)).then((rows) =>
        rows.find((p) => p.owner === owner && p.id === id),
      ),
    create: (owner, input) => {
      if (input.timezone !== undefined && !validTimezone(input.timezone)) {
        throw new InvalidInput({ reason: `unknown timezone: ${input.timezone}` });
      }
      if (input.model !== undefined && !KENARI_MODELS.some((m) => m.id === input.model?.id)) {
        throw new InvalidInput({ reason: `unknown model: ${input.model?.id}` });
      }
      const profile: ProfileInfo = {
        id: randomUUID(),
        owner,
        name: input.name.trim().slice(0, 80),
        description: (input.description ?? "").slice(0, 500),
        persona: (input.persona ?? "").slice(0, 8_000),
        timezone: input.timezone ?? defaultTimezone(),
        model: input.model ?? null,
        toolAllowlist: input.toolAllowlist ?? null,
        policies: { ...defaultPolicies(), ...input.policies },
        createdAt: Date.now(),
        archivedAt: null,
      };
      return run(commitProfiles(converse, (profiles) => [...profiles, profile])).then(async () => {
        // Spawning initiates the conversation: the bot's first turn runs
        // under its own identity, built from the provided details. Best
        // effort — admission succeeds even when the model call cannot run.
        if (input.onboard !== false) void onboard(owner, profile);
        return profile;
      });
    },
    update: async (owner, id, patch) => {
      if (patch.timezone !== undefined && !validTimezone(patch.timezone)) {
        throw new InvalidInput({ reason: `unknown timezone: ${patch.timezone}` });
      }
      if (patch.model !== undefined && !KENARI_MODELS.some((m) => m.id === patch.model?.id)) {
        throw new InvalidInput({ reason: `unknown model: ${patch.model?.id}` });
      }
      const rows = await run(readProfiles(converse));
      const current = rows.find((p) => p.owner === owner && p.id === id);
      if (current === undefined) throw new NotFound({ what: `profile ${id}` });
      const next: ProfileInfo = {
        ...current,
        name: patch.name !== undefined ? patch.name.trim().slice(0, 80) : current.name,
        description: patch.description !== undefined ? patch.description : current.description,
        persona: patch.persona !== undefined ? patch.persona : current.persona,
        timezone: patch.timezone ?? current.timezone,
        model: patch.model !== undefined ? patch.model : current.model,
        toolAllowlist:
          patch.toolAllowlist !== undefined ? patch.toolAllowlist : current.toolAllowlist,
        policies: patch.policies !== undefined ? patch.policies : current.policies,
      };
      await run(
        commitProfiles(converse, (profiles) =>
          profiles.map((row) => (row.id === id && row.owner === owner ? next : row)),
        ),
      );
      return next;
    },
    setArchived: (owner, id, archived) =>
      run(
        commitProfiles(converse, (rows) =>
          rows.map((row) =>
            row.id === id && row.owner === owner
              ? { ...row, archivedAt: archived ? Date.now() : null }
              : row,
          ),
        ),
      )
        .then(() => service.get(owner, id))
        .then((profile) => {
          if (profile === undefined) throw new NotFound({ what: `profile ${id}` });
          return profile;
        }),
    remove: async (owner, id) => {
      const rows = await run(readSessions(converse));
      const mine = rows.filter((row) => row.owner === owner && row.profile === id);
      await run(
        commitSessions(converse, (sessions) =>
          sessions.filter((row) => !(row.owner === owner && row.profile === id)),
        ),
      );
      await run(
        commitProfiles(converse, (profiles) =>
          profiles.filter((p) => !(p.owner === owner && p.id === id)),
        ),
      );
      return mine;
    },
    ensureDefault: (owner) =>
      run(readProfiles(converse)).then((rows) => {
        const existing = rows.find((p) => p.owner === owner && p.id === "default");
        if (existing !== undefined) return existing;
        const profile: ProfileInfo = {
          id: "default",
          owner,
          name: "Ultius",
          description: "The default entity.",
          persona: "",
          timezone: defaultTimezone(),
          model: null,
          toolAllowlist: null,
          policies: defaultPolicies(),
          createdAt: Date.now(),
          archivedAt: null,
        };
        return run(commitProfiles(converse, (profiles) => [...profiles, profile])).then(
          () => profile,
        );
      }),
    ensureMain: (owner, profileId) => {
      const flightKey = `${owner}:${profileId}`;
      const inFlight = mainInFlight.get(flightKey);
      if (inFlight !== undefined) return inFlight;
      const promise = ensureMainOnce(owner, profileId).finally(() => {
        mainInFlight.delete(flightKey);
      });
      mainInFlight.set(flightKey, promise);
      return promise;
    },
    resetMain: async (owner, profileId) => {
      // The old main row stays listed as a plain session (history kept);
      // a fresh main id means a fresh conversation key.
      await run(
        commitSessions(converse, (sessions) =>
          sessions.map((row) =>
            row.owner === owner && row.profile === profileId && row.kind === "main"
              ? { ...row, kind: "session" as const, title: `${row.title} (reset)` }
              : row,
          ),
        ),
      );
      return service.ensureMain(owner, profileId);
    },
    createSession: async (owner, profileId, title) => {
      const profile = await ensureProfileRow(owner, profileId);
      if (profile.archivedAt !== null) throw new InvalidInput({ reason: "profile is archived" });
      const row: SessionInfo = {
        id: randomUUID(),
        owner,
        profile: profileId,
        kind: "session",
        participants: null,
        title: title ?? "",
        createdAt: Date.now(),
        lastMessageAt: Date.now(),
      };
      await run(commitSessions(converse, (sessions) => [...sessions, row]));
      await ensureConversationFor(scopedKey(owner, profileId, row.id), profile, {
        owner,
        profileId,
        kind: "session",
        participants: null,
      });
      return row;
    },
    listSessions: (owner, profileId) =>
      run(readSessions(converse)).then((rows) =>
        rows
          // Legacy pair-DM rows predate rooms; they were never the owner's
          // chats (and carried the shared-identity bug) — keep them out of
          // the list. DELETE /api/sessions/:id still removes them.
          .filter((row) => row.kind !== "dm")
          .filter((row) =>
            profileId === undefined
              ? row.owner === owner
              : row.owner === owner &&
                (row.profile === profileId || row.participants?.includes(profileId) === true),
          ),
      ),
    removeSession: (owner, id) =>
      run(
        commitSessions(converse, (sessions) =>
          sessions.filter((row) => !(row.id === id && row.owner === owner)),
        ),
      ).then(() => true),
    touchSession: async (owner, chatId, info) => {
      const seedTitle =
        info.titleSeed !== undefined ? await titleFor(generate, info.titleSeed) : undefined;
      await run(
        commitSessions(converse, (sessions) => {
          const index = sessions.findIndex(
            (row) => row.id === chatId && (row.owner === owner || owner === "guest"),
          );
          if (index < 0) {
            // Register on first contact (legacy ids included), under default.
            return [
              ...sessions,
              {
                id: chatId,
                owner,
                profile: "default",
                kind: "session" as const,
                participants: null,
                title: seedTitle ?? chatId,
                createdAt: info.at,
                lastMessageAt: info.at,
              },
            ];
          }
          const current = sessions[index] as SessionInfo;
          sessions[index] = {
            ...current,
            lastMessageAt: info.at,
            title: current.title === "" && seedTitle !== undefined ? seedTitle : current.title,
          };
          return sessions;
        }),
      );
    },
    rowOf: (id) => run(readSessions(converse)).then((rows) => rows.find((row) => row.id === id)),
    keyOfRow: (row) => keyOfRowImpl(row),
    keyForSession: async (owner, id) => {
      const row = await service.rowOf(id);
      if (row !== undefined && (row.owner === owner || owner === "guest")) {
        return keyOfRowImpl(row);
      }
      return scopedKey(owner, "default", id);
    },
    adoptConversation: async (key, scope) => {
      const profile = await service.get(scope.owner, scope.profileId);
      if (profile === undefined) throw new NotFound({ what: `profile ${scope.profileId}` });
      await ensureConversationFor(key, profile, {
        owner: scope.owner,
        profileId: scope.profileId,
        kind: scope.kind,
        participants: scope.participants,
      });
    },
    mainOf: async (owner) => {
      const stored = await run(converse.docs.snapshot(SettingsDoc));
      const main = stored?.main[owner];
      if (main !== undefined && main !== "") return main;
      const rows = await run(readProfiles(converse));
      const owned = rows.filter((p) => p.owner === owner);
      const fallback = owned.find((p) => p.id === "default") ?? owned[0];
      return fallback?.id ?? "default";
    },
    setMain: async (owner, profileId) => {
      const profile = await service.get(owner, profileId);
      if (profile === undefined) throw new NotFound({ what: `profile ${profileId}` });
      await run(
        converse.docs.commit(async (tx) => {
          const draft = await tx.doc(SettingsDoc);
          draft.main = { ...draft.main, [owner]: profileId };
        }),
      );
    },
    scopeOf: (conversationId) => scopeIndex.get(String(conversationId)),
    profileOf: (conversationId) => profileByConversation.get(String(conversationId)),
    agentFor: (profile): AgentChange => {
      const tools =
        profile.toolAllowlist === null
          ? undefined
          : (deps
              .tools()
              .filter((tool) =>
                profile.toolAllowlist?.includes(tool.name),
              ) as unknown as NonNullable<AgentChange["tools"]>);
      return {
        ...(profile.model !== null
          ? {
              model: { provider: "kenari", modelId: profile.model.id },
              // An empty effort string means "the model's default".
              ...(profile.model.effort !== ""
                ? { thinkingLevel: profile.model.effort as ModelThinkingLevel }
                : {}),
            }
          : {}),
        ...(tools !== undefined ? { tools } : {}),
      };
    },
  };
  void ensureIndex();
  return service;
};
