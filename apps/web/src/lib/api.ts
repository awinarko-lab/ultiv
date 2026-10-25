import type { ModelInfo, ProfileInfo, SessionInfo, TaskInfo } from "@ultiv/contracts";

/**
 * The session registry and model catalog are plain REST on the server's HTTP
 * handler (CRUD over chord's replicated-object wire desyncs on attach). Same
 * base as the chord link: VITE_CHORD_URL in dev/prod override, relative in
 * same-origin builds.
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

export const api = {
  sessions: (profile?: string): Promise<SessionInfo[]> =>
    getJson<SessionInfo[]>(
      profile !== undefined
        ? `/api/sessions?profile=${encodeURIComponent(profile)}`
        : "/api/sessions",
    ),
  profiles: (): Promise<ProfileInfo[]> => getJson<ProfileInfo[]>("/api/profiles"),
  createProfile: async (input: { name: string; persona?: string }): Promise<ProfileInfo> => {
    const response = await fetch(`${base()}/api/profiles`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`POST /api/profiles: ${response.status}`);
    return (await response.json()) as ProfileInfo;
  },
  mainChat: async (profileId: string): Promise<SessionInfo> => {
    const response = await fetch(`${base()}/api/profiles/${encodeURIComponent(profileId)}/main`);
    if (!response.ok) throw new Error(`GET main: ${response.status}`);
    return (await response.json()) as SessionInfo;
  },
  models: (): Promise<ModelInfo[]> => getJson<ModelInfo[]>("/api/models"),
  create: async (title: string | null, profileId?: string): Promise<{ id: string }> => {
    const response = await fetch(`${base()}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, ...(profileId !== undefined ? { profileId } : {}) }),
    });
    if (!response.ok) throw new Error(`POST /api/sessions: ${response.status}`);
    return (await response.json()) as { id: string };
  },
  remove: async (id: string): Promise<boolean> => {
    const response = await fetch(`${base()}/api/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return response.ok;
  },
  tasks: (): Promise<TaskInfo[]> => getJson<TaskInfo[]>("/api/tasks"),
  removeTask: async (id: string): Promise<boolean> => {
    const response = await fetch(`${base()}/api/tasks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return response.ok;
  },
};
