import { useCallback, useEffect, useState } from "react";
import type { SessionInfo } from "@ultiv/contracts";
import { openSessions, type SessionsRef } from "./chord.ts";

export function useSessions(): {
  phase: "connecting" | "live" | "lost";
  sessions: SessionInfo[];
  create: (title: string | null) => Promise<{ id: string } | undefined>;
} {
  const [phase, setPhase] = useState<"connecting" | "live" | "lost">("connecting");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
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
    };
  }, []);

  const create = useCallback(
    async (title: string | null) => {
      if (ref === undefined) return undefined;
      return ref.create({ title });
    },
    [ref],
  );

  return { phase, sessions, create };
}
