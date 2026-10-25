import type {
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

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${base()}${path}`);
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  return (await response.json()) as T;
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base()}${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
  return (await response.json()) as T;
}

async function drop(path: string): Promise<boolean> {
  const response = await fetch(`${base()}${path}`, { method: "DELETE" });
  return response.ok;
}

export interface RoomDetail {
  room: RoomInfo;
  participants: { profileId: string; name: string }[];
  timeline: { at: number; speaker: string; text: string; system: boolean }[];
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
  main: (): Promise<{ profileId: string }> => getJson<{ profileId: string }>("/api/main"),
  setMain: (id: string): Promise<{ ok: boolean }> =>
    send<{ ok: boolean }>(`/api/profiles/${encodeURIComponent(id)}/main`, "POST"),
  mainChat: (profileId: string): Promise<SessionInfo> =>
    getJson<SessionInfo>(`/api/profiles/${encodeURIComponent(profileId)}/main`),
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
  removeTask: (id: string): Promise<boolean> => drop(`/api/tasks/${encodeURIComponent(id)}`),
};
