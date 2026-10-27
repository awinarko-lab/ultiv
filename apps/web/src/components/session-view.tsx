import { useEffect, useRef, useState } from "react";
import type {
  ModelInfo,
  PendingApproval,
  Phase,
  ThinkingLevel,
  TranscriptEntry,
  UsageSummary,
} from "@ultiv/contracts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ApprovalCard, type Decide } from "@/components/approval-card";
import { ChatSkeleton, EmptyChat, StatusRow } from "@/components/chat-states";
import { Composer } from "@/components/composer";
import { ChatHeader, type ChatBot, type LinkState } from "@/components/chat-header";
import { TranscriptItems } from "@/components/transcript-items";

/**
 * The polite live-region text: a finished reply or a gate waiting on the
 * owner. Whatever was already on screen at mount is not re-announced.
 */
function useAnnouncement(
  botName: string | undefined,
  transcript: TranscriptEntry[],
  pending: PendingApproval,
): string {
  const who = botName !== undefined && botName !== "" ? botName : "The bot";
  const lastReply = transcript.findLast((entry) => entry.kind === "output" && !entry.streaming);
  const seen = useRef<number | null | undefined>(undefined);
  if (seen.current === undefined && transcript.length > 0) seen.current = lastReply?.id ?? null;
  if (pending !== null) return `${who} needs your approval for ${pending.name}.`;
  if (lastReply === undefined || lastReply.kind !== "output" || lastReply.id === seen.current) {
    return "";
  }
  return `${who}: ${lastReply.text.slice(0, 280)}`;
}

const floatingError =
  "bg-background/70 text-destructive w-fit rounded-lg px-3 py-1.5 text-sm backdrop-blur-md";

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
  // The composer floats over the transcript; its height (it grows with the
  // draft) becomes the transcript's bottom padding so the last message clears it.
  const footerRef = useRef<HTMLElement | null>(null);
  const [footerHeight, setFooterHeight] = useState(80);
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

  useEffect(() => {
    const footer = footerRef.current;
    if (footer === null) return;
    const observer = new ResizeObserver(() => setFooterHeight(footer.offsetHeight));
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  // Pin the transcript to the newest entry only while the user is pinned there.
  useEffect(() => {
    const viewport = transcriptRef.current?.querySelector("[data-slot=scroll-area-viewport]");
    if (viewport === null || viewport === undefined || !pinned.current) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [transcript, busy, pending, footerHeight]);

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

  const announcement = useAnnouncement(bot?.name, transcript, pending);

  return (
    // Frameless: the chat is the page. The transcript fills it and scrolls
    // UNDER the translucent header and composer, which float on top.
    // --chat-bottom is how much the page reserves below (the phone tab bar).
    <section aria-label="Chat" className="relative min-h-0 flex-1">
      <div ref={transcriptRef} className="absolute inset-0">
        <ScrollArea className="h-full">
          <ul
            className="flex flex-col gap-3 pt-[calc(3.75rem+env(safe-area-inset-top))] pr-2"
            style={{
              paddingBottom: `calc(${footerHeight + 12}px + var(--chat-bottom, env(safe-area-inset-bottom)))`,
            }}
          >
            {transcript.length === 0 && link === "connecting" && <ChatSkeleton />}
            {transcript.length === 0 && link === "live" && !busy && (
              <EmptyChat bot={bot} onPick={setDraft} />
            )}
            <TranscriptItems transcript={transcript} />
            {(busy || pending !== null) && (
              <StatusRow bot={bot} transcript={transcript} pending={pending} />
            )}
          </ul>
        </ScrollArea>
      </div>
      <div className="from-background/80 pointer-events-none absolute inset-x-0 top-0 z-10 h-14 bg-linear-to-b to-transparent" />
      <div className="absolute inset-x-0 top-0 z-10 pt-[max(0.5rem,env(safe-area-inset-top))]">
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
      </div>
      {/* Screen readers hear new replies and approval requests. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <footer
        ref={footerRef}
        className="pointer-events-none absolute inset-x-0 z-10 flex flex-col gap-2 pb-3 *:pointer-events-auto"
        style={{ bottom: "var(--chat-bottom, env(safe-area-inset-bottom))" }}
      >
        {lastError !== null && <p className={floatingError}>{lastError}</p>}
        {controlError !== null && (
          <p className={floatingError}>Couldn't apply that: {controlError}</p>
        )}
        {pending !== null && <ApprovalCard pending={pending} onDecide={onDecide} />}
        <Composer
          botName={bot?.name}
          live={link === "live"}
          busy={busy}
          sending={sending}
          sendFailed={sendFailed}
          draft={draft}
          onDraft={setDraft}
          onSend={() => void run()}
          onStop={() => control(onInterrupt)}
        />
      </footer>
    </section>
  );
}
