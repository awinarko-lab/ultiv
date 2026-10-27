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
import { ArrowUpIcon, CircleAlertIcon, CircleStopIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TranscriptItems } from "@/components/transcript-items";

/**
 * Tools that reach outside the conversation (delete/send/pay/publish): their
 * approval cards carry an explicit warning and a red border.
 */
const RISKY_TOOL =
  /delete|remove|purge|drop|send|post|email|tweet|publish|pay|transfer|archive|overwrite/i;

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
  const select =
    "rounded-md border bg-transparent px-2 py-1 text-xs text-muted-foreground outline-none";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
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

export function SessionView({
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
  link: "connecting" | "live" | "lost";
  transcript: TranscriptEntry[];
  phase: Phase;
  lastError: string | null;
  pending: PendingApproval;
  usage: UsageSummary | null;
  model: string | null;
  effort: ThinkingLevel | null;
  models: ModelInfo[];
  onInput: (text: string) => void;
  onDecide: (callId: string, approved: boolean, always?: boolean, takeover?: boolean) => void;
  onConfigure: (model: string | null, effort: ThinkingLevel | null) => void;
  onInterrupt: () => void;
}) {
  const [draft, setDraft] = useState("");
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

  const run = () => {
    const text = draft.trim();
    if (text === "" || busy) return;
    onInput(text);
    setDraft("");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    run();
  };

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Transcript</CardTitle>
          <Badge variant={link === "live" ? "secondary" : "outline"}>{link}</Badge>
        </div>
        <SessionMeta
          usage={usage}
          model={model}
          effort={effort}
          models={models}
          onConfigure={onConfigure}
        />
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        <div ref={transcriptRef} className="h-full min-h-0">
          <ScrollArea className="h-full">
            <ul className="flex flex-col gap-3 pr-3">
              <TranscriptItems transcript={transcript} />
              {busy &&
                pending === null &&
                !transcript.some((entry) => entry.kind === "output" && entry.streaming) && (
                  <li className="self-start text-sm text-muted-foreground">working…</li>
                )}
            </ul>
          </ScrollArea>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        {lastError !== null && <p className="w-full text-sm text-destructive">{lastError}</p>}
        {pending !== null && (
          <Card
            className={
              RISKY_TOOL.test(pending.name) ? "w-full border-destructive" : "w-full border-ring"
            }
          >
            <CardHeader className="pb-0">
              <CardTitle className="text-sm">Approve {pending.name}?</CardTitle>
            </CardHeader>
            {RISKY_TOOL.test(pending.name) && (
              <CardContent className="pb-0">
                <p className="text-destructive flex items-center gap-1 text-xs">
                  <CircleAlertIcon className="size-3.5" />
                  This reaches outside the conversation and may not be reversible — check the
                  details.
                </p>
              </CardContent>
            )}
            <CardContent className="pt-2">
              <p className="text-muted-foreground text-xs">
                “Always allow” saves {pending.name} to this bot’s auto-approve rules. “Take over”
                declines the call and tells the bot you are doing it yourself.
              </p>
              <CodeBlock size="sm">
                <CodeBlockContent wrap className="max-h-48 overflow-y-auto">
                  {JSON.stringify(pending.input, null, 2)}
                </CodeBlockContent>
              </CodeBlock>
            </CardContent>
            <CardFooter className="flex-wrap justify-end gap-2 pb-3">
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => onDecide(pending.callId, false, undefined, true)}
              >
                Take over
              </Button>
              <Button size="sm" variant="outline" onClick={() => onDecide(pending.callId, false)}>
                Deny
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onDecide(pending.callId, true, true)}
              >
                Always allow
              </Button>
              <Button size="sm" onClick={() => onDecide(pending.callId, true)}>
                Approve
              </Button>
            </CardFooter>
          </Card>
        )}
        <form className="flex w-full flex-col gap-2" onSubmit={submit}>
          <InputGroup>
            <InputGroupTextarea
              placeholder={link === "live" ? "Give the agent a task…" : "Waiting for link…"}
              value={draft}
              disabled={link !== "live"}
              rows={2}
              className="min-h-16 resize-none"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  run();
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
                  onClick={onInterrupt}
                  disabled={link !== "live"}
                >
                  <CircleStopIcon /> Stop
                </InputGroupButton>
              )}
              <InputGroupButton
                type="submit"
                size="xs"
                variant="default"
                className="ml-auto"
                disabled={link !== "live" || busy}
              >
                Run <ArrowUpIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </CardFooter>
    </Card>
  );
}
