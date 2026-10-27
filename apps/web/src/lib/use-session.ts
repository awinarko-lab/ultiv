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
  input: (text: string) => Promise<void>;
  decide: (
    callId: string,
    approved: boolean,
    always?: boolean,
    takeover?: boolean,
  ) => Promise<void>;
  configure: (model: string | null, effort: ThinkingLevel | null) => Promise<void>;
  interrupt: () => Promise<void>;
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

  // Every action resolves when the server accepted it and rejects otherwise —
  // the view decides how to surface the failure (nothing is swallowed here).
  const linked = useCallback((): SessionRef => {
    if (ref === undefined) throw new Error("Not connected");
    return ref;
  }, [ref]);

  const input = useCallback(
    async (text: string): Promise<void> => {
      await linked().input({ text });
    },
    [linked],
  );

  const decide = useCallback(
    async (
      callId: string,
      approved: boolean,
      always?: boolean,
      takeover?: boolean,
    ): Promise<void> => {
      await linked().approve({
        callId,
        approved,
        ...(always === true ? { always: true } : {}),
        ...(takeover === true ? { takeover: true } : {}),
      });
    },
    [linked],
  );

  const configure = useCallback(
    async (model: string | null, effort: ThinkingLevel | null): Promise<void> => {
      await linked().configure({ model, effort });
    },
    [linked],
  );

  const interrupt = useCallback(async (): Promise<void> => {
    await linked().interrupt({});
  }, [linked]);

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
