/**
 * The Profiles faculty: user-defined AI entities above sessions. One runtime,
 * one entity per profile — each profile owns its main chat ("Bot Mode"),
 * sessions, per-pair DM threads, artifacts scope and persona. This module owns
 * the session registry doc (v3: profile/kind/participants) and the
 * conversation→profile index that persona rendering, audit stamping and the
 * artifact scope resolver all read.
 */
import { randomUUID } from "node:crypto";
import { defineDoc } from "@earendil-works/pi-durable";
import type { AgentChange } from "@earendil-works/pi-durable";
import { Effect } from "effect";
import { Type } from "typebox";
import { InvalidInput, NotFound } from "@ultiv/core";
import type { ProfileCreate, ProfileInfo, ProfilePolicies, SessionInfo } from "@ultiv/contracts";
import { KENARI_MODELS } from "../providers/kenari.ts";
import { TasksDoc, taskConversationKey } from "../tasks/tasks.ts";
import type { ConverseService } from "../converse/converse.ts";
import type { GenerateService } from "../generate/generate.ts";

/** Registry doc: every profile row, owner-partitioned like the sessions doc. */
export const ProfilesDoc = defineDoc<{ profiles: ProfileInfo[] }>({
  kind: "ultiv.profiles",
  version: 1,
  scope: "session",
  initial: () => ({ profiles: [] }),
  checkpointWhen: () => true,
});

/**
 * The session registry (v3). Migrates stamp `profile: "default"` and
 * `kind: "session"` onto pre-profile rows — the same move the v1→v2 owner
 * stamp made, one level deeper.
 */
export const SessionsDoc = defineDoc<{ sessions: SessionInfo[] }>({
  kind: "ultiv.sessions",
  version: 3,
  scope: "session",
  initial: () => ({ sessions: [] }),
  // Rows may arrive from v1 (no owner) or v2 (no profile/kind/participants);
  // stamp every missing field. Pre-profile sessions belonged to the default
  // profile by definition.
  migrate: (value) => {
    const stored = (value.sessions ?? []) as unknown as ReadonlyArray<Record<string, unknown>>;
    const sessions = stored.map((row) => ({
      ...row,
      owner: typeof row.owner === "string" ? row.owner : "guest",
      profile: typeof row.profile === "string" ? row.profile : "default",
      kind: row.kind === "main" || row.kind === "dm" ? row.kind : "session",
      participants: Array.isArray(row.participants) ? row.participants : null,
    }));
    return { sessions } as unknown as { sessions: SessionInfo[] };
  },
  checkpointWhen: () => true,
});

/** The main-chat session id prefix; each reset rotates to a fresh id. */
const MAIN_PREFIX = "main-";

/** Conversation keys. Scoped form `{owner}:{profile}:{id}`; DM pairs share one thread. */
export const scopedKey = (owner: string, profile: string, id: string): string =>
  `${owner}:${profile}:${id}`;
export const legacyKey = (owner: string, id: string): string => `${owner}:${id}`;
export const pairKey = (owner: string, a: string, b: string): string =>
  `${owner}:pair:${[a, b].sort().join("|")}`;
export const pairSessionId = (a: string, b: string): string => `dm-${[a, b].sort().join("|")}`;

export const defaultPolicies = (): ProfilePolicies => ({
  canInitiate: [],
  autoApprove: [],
  approvalTimeout: "deny",
  dailyTurnBudget: null,
  memoryKeeper: false,
});

export const defaultTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  } catch {
    return "UTC";
  }
};

const validTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Normalize stored rows on every read (defence below the migrate). */
const normalizeRow = (row: SessionInfo): SessionInfo => ({
  ...row,
  owner: typeof row.owner === "string" ? row.owner : "guest",
  profile: typeof row.profile === "string" ? row.profile : "default",
  kind: row.kind === "main" || row.kind === "dm" ? row.kind : "session",
  participants: Array.isArray(row.participants) ? row.participants : null,
});

const readSessions = (converse: ConverseService) =>
  Effect.map(converse.docs.snapshot(SessionsDoc), (doc) => (doc?.sessions ?? []).map(normalizeRow));

const readProfiles = (converse: ConverseService) =>
  Effect.map(converse.docs.snapshot(ProfilesDoc), (doc) => doc?.profiles ?? []);

const commitSessions = (
  converse: ConverseService,
  change: (sessions: SessionInfo[]) => SessionInfo[],
) =>
  converse.docs.commit(async (tx) => {
    const draft = await tx.doc(SessionsDoc);
    draft.sessions = change(draft.sessions.map(normalizeRow));
  });

const commitProfiles = (
  converse: ConverseService,
  change: (profiles: ProfileInfo[]) => ProfileInfo[],
) =>
  converse.docs.commit(async (tx) => {
    const draft = await tx.doc(ProfilesDoc);
    draft.profiles = change(draft.profiles);
  });

/** A short title for a conversation's first message; truncation on any failure. */
async function titleFor(generate: GenerateService, seed: string): Promise<string> {
  const fallback = (text: string): string => {
    const trimmed = text.trim();
    return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
  };
  try {
    const generated = await Effect.runPromise(
      generate.extract({
        schema: Type.Object({ title: Type.String() }),
        maxTokens: 64,
        prompt:
          `Write a 3-6 word title for a conversation that starts with the message below. ` +
          `Reply as JSON {"title": "..."}.\n\n<message>\n${seed.slice(0, 500)}\n</message>`,
      }),
    );
    const title = generated.title.trim().slice(0, 80);
    return title === "" ? fallback(seed) : title;
  } catch {
    return fallback(seed);
  }
}

/** One mapped conversation's profile scope. */
export interface ConversationScope {
  readonly owner: string;
  readonly profileId: string;
  readonly kind: SessionInfo["kind"];
  readonly participants: readonly string[] | null;
}

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
  /** Ensure the DM thread between two profiles exists; returns its session row. */
  readonly ensureDm: (owner: string, a: string, b: string) => Promise<SessionInfo>;
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
    if (profileId === "default") return service.ensureDefault(owner);
    const profile = await service.get(owner, profileId);
    if (profile === undefined) throw new NotFound({ what: `profile ${profileId}` });
    return profile;
  };

  const service: ProfilesService = {
    list: async (owner) => {
      // Listing is a touch: owners see their default profile materialized.
      await service.ensureDefault(owner);
      return run(readProfiles(converse)).then((rows) => rows.filter((p) => p.owner === owner));
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
      return run(commitProfiles(converse, (profiles) => [...profiles, profile])).then(
        () => profile,
      );
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
    ensureMain: async (owner, profileId) => {
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
        rows.filter((row) =>
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
    ensureDm: async (owner, a, b) => {
      const [profileA, profileB] = await Promise.all([
        ensureProfileRow(owner, a),
        ensureProfileRow(owner, b),
      ]);
      const id = pairSessionId(a, b);
      const rows = await run(readSessions(converse));
      const existing = rows.find((row) => row.id === id && row.owner === owner);
      if (existing !== undefined) return existing;
      const row: SessionInfo = {
        id,
        owner,
        profile: a,
        kind: "dm",
        participants: [a, b],
        title: `${profileA.name} ↔ ${profileB.name}`,
        createdAt: Date.now(),
        lastMessageAt: Date.now(),
      };
      await run(commitSessions(converse, (sessions) => [...sessions, row]));
      await ensureConversationFor(pairKey(owner, a, b), profileA, {
        owner,
        profileId: a,
        kind: "dm",
        participants: [a, b],
      });
      return row;
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
          ? { model: { provider: "kenari", modelId: profile.model.id } }
          : {}),
        ...(tools !== undefined ? { tools } : {}),
      };
    },
  };
  void ensureIndex();
  return service;
};
