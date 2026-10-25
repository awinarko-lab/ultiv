import { useCallback, useEffect, useState } from "react";
import type { ModelInfo, SessionInfo } from "@ultiv/contracts";
import { openSessions, type SessionsRef } from "./chord.ts";

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
  const [ref, setRef] = useState<SessionsRef | undefined>(undefined);

  useEffect(() => {
    let active = true;
    let current: SessionsRef | undefined;
    let unsubscribe: (() => void) | undefined;
    openSessions()
      .then((opened) => {
        if (!active) {
          opened.release();
          return;
        }
        current = opened;
        setRef(opened);
        setPhase("live");
        unsubscribe = opened.sessions.subscribe(setSessions);
        opened.models.subscribe(setModels);
      })
      .catch(() => {
        if (active) setPhase("lost");
      });
    return () => {
      active = false;
      unsubscribe?.();
      current?.release();
      setRef(undefined);
      setPhase("connecting");
      setSessions([]);
      setModels([]);
    };
  }, []);

  const create = useCallback(
    async (title: string | null) => {
      if (ref === undefined) return undefined;
      return ref.create({ title });
    },
    [ref],
  );

  const remove = useCallback(
    async (id: string) => {
      if (ref === undefined) return false;
      const result = await ref.remove({ id });
      return result.ok;
    },
    [ref],
  );

  return { phase, sessions, models, create, remove };
}
