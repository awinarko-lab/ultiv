import { useCallback, useEffect, useState } from "react";
import type { ModelInfo, ProfileInfo, SessionInfo } from "@ultiv/contracts";
import { api } from "./api";

export function useSessions(): {
  phase: "connecting" | "live" | "lost";
  sessions: SessionInfo[];
  models: ModelInfo[];
  profiles: ProfileInfo[];
  /** The selected profile id; undefined = every profile (all sessions). */
  selected: string | undefined;
  select: (profileId: string | undefined) => void;
  createProfile: (input: { name: string; persona?: string }) => Promise<ProfileInfo | undefined>;
  create: (title: string | null) => Promise<{ id: string } | undefined>;
  remove: (id: string) => Promise<boolean>;
} {
  const [phase, setPhase] = useState<"connecting" | "live" | "lost">("connecting");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [selected, setSelected] = useState<string | undefined>(undefined);

  const refresh = useCallback(async (profileId?: string) => {
    try {
      const [list, modelList, profileList] = await Promise.all([
        api.sessions(profileId),
        api.models(),
        api.profiles(),
      ]);
      setSessions(list);
      setModels(modelList);
      setProfiles(profileList);
      setPhase("live");
    } catch {
      setPhase("lost");
    }
  }, []);

  useEffect(() => {
    void refresh(selected);
    const onFocus = (): void => {
      void refresh(selected);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh, selected]);

  const select = useCallback(
    (profileId: string | undefined) => {
      setSelected(profileId);
      void refresh(profileId);
    },
    [refresh],
  );

  const createProfile = useCallback(
    async (input: { name: string; description?: string; persona?: string }) => {
      try {
        const created = await api.createProfile(input);
        await refresh(created.id);
        setSelected(created.id);
        return created;
      } catch {
        return undefined;
      }
    },
    [refresh],
  );

  const create = useCallback(
    async (title: string | null) => {
      try {
        const created = await api.create(title, selected);
        await refresh(selected);
        return created;
      } catch {
        return undefined;
      }
    },
    [refresh, selected],
  );

  const remove = useCallback(
    async (id: string) => {
      const ok = await api.remove(id);
      await refresh(selected);
      return ok;
    },
    [refresh, selected],
  );

  return { phase, sessions, models, profiles, selected, select, createProfile, create, remove };
}
