import type {
  MemoryRecord,
  ModelInfo,
  ProfileInfo,
  RoomInfo,
  SessionInfo,
  TaskInfo,
  VaultItemInfo,
} from "@ultiv/contracts";

/**
 * The registries are plain REST on the server's HTTP handler (CRUD over
 * chord's replicated-object wire desyncs on attach). Same base as the chord
 * link: VITE_CHORD_URL in dev/prod override, relative in same-origin builds.
 */
function base(): string {
  const override = import.meta.env.VITE_CHORD_URL;
  if (override !== undefined && override !== "") {
    return override.replace(/^ws(s?):/, "http$1:").replace(/\/$/, "");
  }
  if (import.meta.env.DEV) return "http://127.0.0.1:8787";
  return "";
}

/** A REST failure carrying the server's own message — never just the status. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, method: string, path: string, detail: string | null) {
    super(detail === null ? `${method} ${path}: ${status}` : detail);
    this.name = "ApiError";
    this.status = status;
  }
}

async function failure(response: Response, method: string, path: string): Promise<ApiError> {
  let detail: string | null = null;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error !== "") detail = body.error;
  } catch {
    // Non-JSON body — the status line is all we have.
  }
  return new ApiError(response.status, method, path, detail);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${base()}${path}`);
  if (!response.ok) throw await failure(response, "GET", path);
  return (await response.json()) as T;
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base()}${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  if (!response.ok) throw await failure(response, method, path);
  return (await response.json()) as T;
}

/** DELETE that fails loudly: a swallowed 409 used to read as success. */
async function drop(path: string): Promise<boolean> {
  const response = await fetch(`${base()}${path}`, { method: "DELETE" });
  if (!response.ok) throw await failure(response, "DELETE", path);
  return true;
}

export interface RoomDetail {
  room: RoomInfo;
  participants: { profileId: string; name: string }[];
  timeline: { at: number; speaker: string; text: string; system: boolean }[];
}

/** One row of GET /api/approvals — a gate waiting on the owner somewhere. */
export interface PendingApprovalRow {
  conversationId: string;
  profile: string;
  kind: string;
  sessionId: string | null;
  callId: string;
  name: string;
  input: unknown;
}

/** One row of GET /api/artifacts — a file a bot made (or the owner uploaded). */
export interface ArtifactRow {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  createdAt: number;
  conversationId: string | null;
  owner: string | null;
  profile: string | null;
}

/** One row of GET /api/tasks/:id/activity — progress, waiting gate, conversation. */
export interface TaskActivity {
  conversationId: string | null;
  waiting: { callId: string; name: string; input: unknown } | null;
  steps: { kind: string; at: number; text: string }[];
}

export const api = {
  sessions: (profile?: string): Promise<SessionInfo[]> =>
    getJson<SessionInfo[]>(
      profile !== undefined
        ? `/api/sessions?profile=${encodeURIComponent(profile)}`
        : "/api/sessions",
    ),
  profiles: (): Promise<ProfileInfo[]> => getJson<ProfileInfo[]>("/api/profiles"),
  rooms: (bot?: string): Promise<RoomInfo[]> =>
    getJson<RoomInfo[]>(
      bot !== undefined ? `/api/rooms?bot=${encodeURIComponent(bot)}` : "/api/rooms",
    ),
  createProfile: (input: {
    name: string;
    description?: string;
    persona?: string;
    model?: { id: string; effort?: string } | null;
  }): Promise<ProfileInfo> => send<ProfileInfo>("/api/profiles", "POST", input),
  updateProfile: (
    id: string,
    patch: {
      name?: string;
      description?: string;
      persona?: string;
      model?: { id: string; effort?: string } | null;
    },
  ): Promise<ProfileInfo> =>
    send<ProfileInfo>(`/api/profiles/${encodeURIComponent(id)}`, "PATCH", patch),
  deleteProfile: (id: string): Promise<boolean> => drop(`/api/profiles/${encodeURIComponent(id)}`),
  archiveProfile: (id: string): Promise<ProfileInfo> =>
    send<ProfileInfo>(`/api/profiles/${encodeURIComponent(id)}/archive`, "POST"),
  unarchiveProfile: (id: string): Promise<ProfileInfo> =>
    send<ProfileInfo>(`/api/profiles/${encodeURIComponent(id)}/unarchive`, "POST"),
  main: (): Promise<{ profileId: string }> => getJson<{ profileId: string }>("/api/main"),
  setMain: (id: string): Promise<{ ok: boolean }> =>
    send<{ ok: boolean }>(`/api/profiles/${encodeURIComponent(id)}/main`, "POST"),
  mainChat: (profileId: string): Promise<SessionInfo> =>
    getJson<SessionInfo>(`/api/profiles/${encodeURIComponent(profileId)}/main`),
  profileMemory: (id: string): Promise<MemoryRecord[]> =>
    getJson<MemoryRecord[]>(`/api/profiles/${encodeURIComponent(id)}/memory`),
  profileMemoryAdd: (id: string, text: string): Promise<MemoryRecord> =>
    send<MemoryRecord>(`/api/profiles/${encodeURIComponent(id)}/memory`, "POST", { text }),
  profileMemoryRemove: (id: string, recordId: string): Promise<boolean> =>
    drop(`/api/profiles/${encodeURIComponent(id)}/memory/${encodeURIComponent(recordId)}`),
  artifacts: (profile: string): Promise<ArtifactRow[]> =>
    getJson<ArtifactRow[]>(`/api/artifacts?profile=${encodeURIComponent(profile)}`),
  artifactUrl: (id: string): string => `${base()}/api/artifacts/${encodeURIComponent(id)}`,
  room: (id: string): Promise<RoomDetail> =>
    getJson<RoomDetail>(`/api/rooms/${encodeURIComponent(id)}`),
  roomSay: (id: string, to: string, text: string): Promise<{ ok: boolean }> =>
    send<{ ok: boolean }>(`/api/rooms/${encodeURIComponent(id)}/say`, "POST", { to, text }),
  vault: (): Promise<VaultItemInfo[]> => getJson<VaultItemInfo[]>("/api/vault"),
  vaultCreate: (item: Record<string, unknown>): Promise<VaultItemInfo> =>
    send<VaultItemInfo>("/api/vault", "POST", item),
  vaultRemove: (id: string): Promise<boolean> => drop(`/api/vault/${encodeURIComponent(id)}`),
  models: (): Promise<ModelInfo[]> => getJson<ModelInfo[]>("/api/models"),
  create: (title: string | null, profileId?: string): Promise<{ id: string }> =>
    send<{ id: string }>("/api/sessions", "POST", {
      title,
      ...(profileId !== undefined ? { profileId } : {}),
    }),
  remove: (id: string): Promise<boolean> => drop(`/api/sessions/${encodeURIComponent(id)}`),
  tasks: (): Promise<TaskInfo[]> => getJson<TaskInfo[]>("/api/tasks"),
  taskActivity: (id: string): Promise<TaskActivity> =>
    getJson<TaskActivity>(`/api/tasks/${encodeURIComponent(id)}/activity`),
  approvalDecide: (
    conversationId: string,
    callId: string,
    approved: boolean,
    always?: boolean,
    takeover?: boolean,
  ): Promise<boolean> =>
    send<boolean>(
      `/api/approvals/${encodeURIComponent(conversationId)}/${encodeURIComponent(callId)}`,
      "POST",
      {
        approved,
        ...(always === true ? { always: true } : {}),
        ...(takeover === true ? { takeover: true } : {}),
      },
    ),
  artifactsFor: (conversationId: string): Promise<ArtifactRow[]> =>
    getJson<ArtifactRow[]>(`/api/artifacts?conversationId=${encodeURIComponent(conversationId)}`),
  pendingApprovals: (): Promise<PendingApprovalRow[]> =>
    getJson<PendingApprovalRow[]>("/api/approvals"),
  removeTask: (id: string): Promise<boolean> => drop(`/api/tasks/${encodeURIComponent(id)}`),
};
