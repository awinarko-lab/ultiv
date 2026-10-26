import { useCallback, useEffect, useState } from "react";
import type {
  PendingApproval,
  Phase,
  ThinkingLevel,
  TranscriptEntry,
  UsageSummary,
} from "@ultiv/contracts";
import { openSession, type SessionRef } from "./chord.ts";

export type LinkPhase = "connecting" | "live" | "lost";

export function useSession(sessionId: string): {
  link: LinkPhase;
  transcript: TranscriptEntry[];
  phase: Phase;
  lastError: string | null;
  pending: PendingApproval;
  usage: UsageSummary | null;
  model: string | null;
  effort: ThinkingLevel | null;
  conversationId: string | null;
  input: (text: string) => void;
  decide: (callId: string, approved: boolean, always?: boolean) => void;
  configure: (model: string | null, effort: ThinkingLevel | null) => void;
  interrupt: () => void;
} {
  const [link, setLink] = useState<LinkPhase>("connecting");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingApproval>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<ThinkingLevel | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
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
        unsubs.push(opened.pending.subscribe(setPending));
        unsubs.push(opened.usage.subscribe(setUsage));
        unsubs.push(opened.model.subscribe(setModel));
        unsubs.push(opened.effort.subscribe(setEffort));
        unsubs.push(opened.conversationId.subscribe(setConversationId));
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
      setPending(null);
      setUsage(null);
      setModel(null);
      setEffort(null);
      setConversationId(null);
    };
  }, [sessionId]);

  const input = useCallback(
    (text: string) => {
      ref?.input({ text }).catch((error) => console.warn("input failed:", error));
    },
    [ref],
  );

  const decide = useCallback(
    (callId: string, approved: boolean, always?: boolean) => {
      ref
        ?.approve({
          callId,
          approved,
          ...(always === true ? { always: true } : {}),
        })
        .catch((error) => console.warn("approve failed:", error));
    },
    [ref],
  );

  const configure = useCallback(
    (model: string | null, effort: ThinkingLevel | null) => {
      ref?.configure({ model, effort }).catch((error) => console.warn("configure failed:", error));
    },
    [ref],
  );

  const interrupt = useCallback(() => {
    ref?.interrupt({}).catch((error) => console.warn("interrupt failed:", error));
  }, [ref]);

  return {
    link,
    transcript,
    phase,
    lastError,
    pending,
    usage,
    model,
    effort,
    conversationId,
    input,
    decide,
    configure,
    interrupt,
  };
}
