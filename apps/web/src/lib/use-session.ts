import { useCallback, useEffect, useState } from "react";
import type { Phase, TranscriptEntry } from "@ultiv/contracts";
import { openSession, type SessionRef } from "./chord.ts";

export type LinkPhase = "connecting" | "live" | "lost";

export function useSession(sessionId: string): {
  link: LinkPhase;
  transcript: TranscriptEntry[];
  phase: Phase;
  lastError: string | null;
  input: (text: string) => void;
} {
  const [link, setLink] = useState<LinkPhase>("connecting");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [ref, setRef] = useState<SessionRef | undefined>(undefined);

  useEffect(() => {
    let active = true;
    let current: SessionRef | undefined;
    const unsubs: Array<() => void> = [];
    openSession(sessionId)
      .then((opened) => {
        if (!active) {
          opened.release();
          return;
        }
        current = opened;
        setRef(opened);
        setLink("live");
        unsubs.push(opened.transcript.subscribe(setTranscript));
        unsubs.push(opened.phase.subscribe(setPhase));
        unsubs.push(opened.lastError.subscribe(setLastError));
        unsubs.push(
          opened.onStatus((status) => {
            if (status === "gone") setLink("lost");
          }),
        );
      })
      .catch(() => {
        if (active) setLink("lost");
      });
    return () => {
      active = false;
      for (const unsub of unsubs) unsub();
      current?.release();
      setRef(undefined);
      setLink("connecting");
      setTranscript([]);
      setPhase("idle");
      setLastError(null);
    };
  }, [sessionId]);

  const input = useCallback(
    (text: string) => {
      ref?.input({ text }).catch((error) => console.warn("input failed:", error));
    },
    [ref],
  );

  return { link, transcript, phase, lastError, input };
}
