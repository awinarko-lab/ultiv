import { useEffect, useRef, useState } from "react";
import type {
  ModelInfo,
  PendingApproval,
  Phase,
  ThinkingLevel,
  TranscriptEntry,
  UsageSummary,
} from "@ultiv/contracts";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { ArrowUpIcon, CircleStopIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ApprovalCard, type Decide } from "@/components/approval-card";
import { ChatHeader, type ChatBot, type LinkState } from "@/components/chat-header";
import { TranscriptItems } from "@/components/transcript-items";

const coarsePointer = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

export function SessionView({
  bot,
  onBack,
  link,
  transcript,
  phase,
  lastError,
  pending,
  usage,
  model,
  effort,
  models,
  onInput,
  onDecide,
  onConfigure,
  onInterrupt,
}: {
  bot?: ChatBot | undefined;
  /** Shown as the header's round back button when set. */
  onBack?: (() => void) | undefined;
  link: LinkState;
  transcript: TranscriptEntry[];
  phase: Phase;
  lastError: string | null;
  pending: PendingApproval;
  usage: UsageSummary | null;
  model: string | null;
  effort: ThinkingLevel | null;
  models: ModelInfo[];
  onInput: (text: string) => Promise<void>;
  onDecide: Decide;
  onConfigure: (model: string | null, effort: ThinkingLevel | null) => Promise<void>;
  onInterrupt: () => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Send failures keep the draft and offer a retry; control failures
  // (model/effort/stop) are reported on the same line.
  const [sendFailed, setSendFailed] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  // Autoscroll only while the user is at the bottom: scrolling up mid-stream
  // must stay put (the transcript keeps growing underneath).
  const pinned = useRef(true);
  const busy = phase === "working";

  useEffect(() => {
    const viewport = transcriptRef.current?.querySelector("[data-slot=scroll-area-viewport]");
    if (viewport === null || viewport === undefined) return;
    const onScroll = (): void => {
      pinned.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80;
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, []);

  // Pin the transcript to the newest entry only while the user is pinned there.
  useEffect(() => {
    const viewport = transcriptRef.current?.querySelector("[data-slot=scroll-area-viewport]");
    if (viewport === null || viewport === undefined || !pinned.current) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [transcript, busy, pending]);

  const run = async (): Promise<void> => {
    const text = draft.trim();
    if (text === "" || busy || sending) return;
    setSending(true);
    setSendFailed(false);
    try {
      await onInput(text);
      // Clear only what was sent — anything typed meanwhile stays.
      setDraft((current) => (current.trim() === text ? "" : current));
    } catch {
      setSendFailed(true);
    } finally {
      setSending(false);
    }
  };

  const control = (action: () => Promise<void>): void => {
    setControlError(null);
    action().catch((cause: unknown) => {
      setControlError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void run();
  };

  return (
    // Frameless: the chat is the page, not a card on it. Transcript scrolls;
    // the composer stays pinned at the bottom of the available height.
    <section aria-label="Chat" className="flex min-h-0 flex-1 flex-col gap-2">
      <ChatHeader
        bot={bot}
        link={link}
        onBack={onBack}
        usage={usage}
        model={model}
        effort={effort}
        models={models}
        onConfigure={(nextModel, nextEffort) => control(() => onConfigure(nextModel, nextEffort))}
      />
      <div className="min-h-0 flex-1">
        <div ref={transcriptRef} className="h-full min-h-0">
          <ScrollArea className="h-full">
            <ul className="flex flex-col gap-3 pr-2">
              <TranscriptItems transcript={transcript} />
              {busy &&
                pending === null &&
                !transcript.some((entry) => entry.kind === "output" && entry.streaming) && (
                  <li className="self-start text-sm text-muted-foreground">working…</li>
                )}
            </ul>
          </ScrollArea>
        </div>
      </div>
      <footer className="flex shrink-0 flex-col gap-2">
        {lastError !== null && <p className="w-full text-sm text-destructive">{lastError}</p>}
        {controlError !== null && (
          <p className="w-full text-sm text-destructive">Couldn't apply that: {controlError}</p>
        )}
        {pending !== null && <ApprovalCard pending={pending} onDecide={onDecide} />}
        <form className="flex w-full flex-col gap-2" onSubmit={submit}>
          <InputGroup>
            <InputGroupTextarea
              placeholder={
                link !== "live"
                  ? "Waiting for link…"
                  : bot !== undefined && bot.name !== ""
                    ? `Message ${bot.name}…`
                    : "Message…"
              }
              value={draft}
              disabled={link !== "live"}
              rows={2}
              className="max-h-[40dvh] min-h-16 resize-none overflow-y-auto"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Touch keyboards have no Shift+Enter: there Enter is a newline
                // and the arrow button sends. Desktop keeps Enter-to-send.
                if (event.key === "Enter" && !event.shiftKey && !coarsePointer()) {
                  event.preventDefault();
                  void run();
                }
              }}
            />
            <InputGroupAddon align="block-end">
              {busy && (
                <InputGroupButton
                  type="button"
                  size="xs"
                  variant="outline"
                  className="text-destructive"
                  onClick={() => control(onInterrupt)}
                  disabled={link !== "live"}
                >
                  <CircleStopIcon /> Stop
                </InputGroupButton>
              )}
              <InputGroupButton
                type="submit"
                size="icon-xs"
                variant="default"
                className="ml-auto"
                aria-label="Send"
                title="Send"
                disabled={link !== "live" || busy || sending}
              >
                <ArrowUpIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {sendFailed && (
            <p className="text-destructive flex items-center gap-2 text-sm" role="alert">
              Not sent.
              <Button type="submit" variant="link" size="xs" className="h-auto p-0">
                Retry
              </Button>
            </p>
          )}
        </form>
      </footer>
    </section>
  );
}
