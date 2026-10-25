import { useCallback, useEffect, useState } from "react";
import type { ModelInfo, SessionInfo } from "@ultiv/contracts";
import { api } from "./api";

export function useSessions(): {
  phase: "connecting" | "live" | "lost";
  sessions: SessionInfo[];
  models: ModelInfo[];
  create: (title: string | null) => Promise<{ id: string } | undefined>;
  remove: (id: string) => Promise<boolean>;
} {
  const [phase, setPhase] = useState<"connecting" | "live" | "lost">("connecting");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [list, modelList] = await Promise.all([api.sessions(), api.models()]);
      setSessions(list);
      setModels(modelList);
      setPhase("live");
    } catch {
      setPhase("lost");
    }
  }, []);

  useEffect(() => {
    void refresh();
    // REST has no push: refocus refetches, which keeps the list honest across
    // tabs and after the tab slept.
    const onFocus = (): void => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const create = useCallback(
    async (title: string | null) => {
      try {
        const created = await api.create(title);
        await refresh();
        return created;
      } catch {
        return undefined;
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const ok = await api.remove(id);
      await refresh();
      return ok;
    },
    [refresh],
  );

  return { phase, sessions, models, create, remove };
}
