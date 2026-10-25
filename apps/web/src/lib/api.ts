import type { ModelInfo, SessionInfo, TaskInfo } from "@ultiv/contracts";

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
  sessions: (): Promise<SessionInfo[]> => getJson<SessionInfo[]>("/api/sessions"),
  models: (): Promise<ModelInfo[]> => getJson<ModelInfo[]>("/api/models"),
  create: async (title: string | null): Promise<{ id: string }> => {
    const response = await fetch(`${base()}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
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
