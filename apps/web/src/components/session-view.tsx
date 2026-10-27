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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ApprovalCard, type Decide } from "@/components/approval-card";
import { TranscriptItems } from "@/components/transcript-items";

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Model and effort selection, plus this session's cumulative spend. */
function SessionMeta({
  usage,
  model,
  effort,
  models,
  onConfigure,
}: {
  usage: UsageSummary | null;
  model: string | null;
  effort: ThinkingLevel | null;
  models: ModelInfo[];
  onConfigure: (model: string | null, effort: ThinkingLevel | null) => void;
}) {
  const selected = models.find((candidate) => candidate.id === model);
  const efforts = selected?.efforts ?? (["off", "low", "high", "max"] as const);
  // min-w-0 + truncation: on phones the selects render at 16px (index.css) and
  // long model labels must shrink rather than push the card wider.
  const select =
    "min-w-0 max-w-full truncate rounded-md border bg-transparent px-2 py-1 text-xs text-muted-foreground outline-none";
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <select
          aria-label="Model"
          className={select}
          value={model ?? ""}
          onChange={(event) => {
            const id = event.target.value === "" ? null : event.target.value;
            onConfigure(id, null);
          }}
        >
          <option value="">Default model</option>
          {models.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Effort"
          className={select}
          value={effort ?? ""}
          onChange={(event) =>
            onConfigure(
              model,
              event.target.value === "" ? null : (event.target.value as ThinkingLevel),
            )
          }
        >
          <option value="">Default effort</option>
          {efforts.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </div>
      {usage !== null && (
        <span className="text-xs text-muted-foreground">
          {formatTokens(usage.totalTokens)} tokens · {formatTokens(usage.input)} in ·{" "}
          {formatTokens(usage.output)} out
        </span>
      )}
    </div>
  );
}

const coarsePointer = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/** The link label, shown only when the chat is not connected. */
const linkLabel = { connecting: "connecting…", live: "live", lost: "disconnected" } as const;

/** Who the chat is with — names the composer and the empty state. */
export interface ChatBot {
  name: string;
  description: string;
}

export function SessionView({
  bot,
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
  link: "connecting" | "live" | "lost";
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
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        {link !== "live" && (
          <Badge variant={link === "lost" ? "destructive" : "outline"}>{linkLabel[link]}</Badge>
        )}
        <SessionMeta
          usage={usage}
          model={model}
          effort={effort}
          models={models}
          onConfigure={(nextModel, nextEffort) => control(() => onConfigure(nextModel, nextEffort))}
        />
      </header>
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
