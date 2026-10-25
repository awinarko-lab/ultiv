import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ModelInfo,
  PendingApproval,
  Phase,
  ThinkingLevel,
  ToolStep,
  TranscriptEntry,
  UsageSummary,
} from "@ultiv/contracts";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { ArrowUpIcon, BrainIcon, CircleAlertIcon, CircleStopIcon, WrenchIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";

const roleStyles = {
  user: "self-end max-w-[85%] rounded-lg bg-primary px-3 py-2 text-primary-foreground",
  agent: "self-start max-w-full rounded-lg bg-muted px-3 py-2",
} as const;

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

/** Agent output is markdown; the newest block streams with a caret while working. */
function Output({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1.5 [&_hr]:my-3 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_h1]:mt-3 [&_h2]:mt-3 [&_h3]:mt-2 [&_pre]:my-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      {streaming && <span className="animate-pulse">▍</span>}
    </div>
  );
}

/** Reasoning as a collapsed Trace step. */
function Thinking({ text }: { text: string }) {
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <BrainIcon />
            </TraceIcon>
            <TraceTitle>Reasoning</TraceTitle>
            <TraceDescription>{text.length} chars</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <p className="text-sm whitespace-pre-wrap italic">{text}</p>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

/** Tool call as a Trace line: name + duration, collapsible input/output. */
function Tool({ step }: { step: ToolStep }) {
  const lineStatus =
    step.status === "running" || step.status === "error" ? { status: step.status } : {};
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine {...lineStatus}>
          <TraceIcon>{step.status === "error" ? <CircleAlertIcon /> : <WrenchIcon />}</TraceIcon>
          <TraceTitle>{step.name}</TraceTitle>
          <TraceDescription>
            {step.durationMs === null ? "running…" : `${step.durationMs} ms`}
          </TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <div className="flex flex-col gap-2">
          <CodeBlock size="sm">
            <CodeBlockHeader>
              <CodeBlockTitle>input</CodeBlockTitle>
            </CodeBlockHeader>
            <CodeBlockContent wrap className="max-h-64 overflow-y-auto">
              {JSON.stringify(step.input, null, 2)}
            </CodeBlockContent>
          </CodeBlock>
          {step.output !== null && step.output !== "" && (
            <CodeBlock size="sm">
              <CodeBlockHeader>
                <CodeBlockTitle>output</CodeBlockTitle>
              </CodeBlockHeader>
              <CodeBlockContent wrap className="max-h-64 overflow-y-auto">
                {step.output}
              </CodeBlockContent>
            </CodeBlock>
          )}
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/** Consecutive tool steps render as one Trace so a run reads as a sequence. */
type Group = { key: string; tools: ToolStep[] } | { key: string; entry: TranscriptEntry };

function groupTranscript(transcript: TranscriptEntry[]): Group[] {
  const groups: Group[] = [];
  for (const entry of transcript) {
    const last = groups[groups.length - 1];
    if (entry.kind === "tool") {
      if (last !== undefined && "tools" in last) {
        last.tools.push(entry.step);
        continue;
      }
      groups.push({ key: String(entry.id), tools: [entry.step] });
      continue;
    }
    groups.push({ key: String(entry.id), entry });
  }
  return groups;
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
  onDecide: (callId: string, approved: boolean) => void;
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
              {groupTranscript(transcript).map((group) =>
                "tools" in group ? (
                  <li key={group.key} className="w-full">
                    <Trace>
                      {group.tools.map((step) => (
                        <Tool key={step.callId} step={step} />
                      ))}
                    </Trace>
                  </li>
                ) : group.entry.kind === "input" ? (
                  <li key={group.key} className={roleStyles.user}>
                    {group.entry.text}
                  </li>
                ) : group.entry.kind === "output" ? (
                  <li key={group.key} className={roleStyles.agent}>
                    <Output text={group.entry.text} streaming={group.entry.streaming} />
                  </li>
                ) : group.entry.kind === "thinking" ? (
                  <li key={group.key} className="w-full">
                    <Thinking text={group.entry.text} />
                  </li>
                ) : null,
              )}
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
          <Card className="w-full border-ring">
            <CardHeader className="pb-0">
              <CardTitle className="text-sm">Approve {pending.name}?</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <CodeBlock size="sm">
                <CodeBlockContent wrap className="max-h-48 overflow-y-auto">
                  {JSON.stringify(pending.input, null, 2)}
                </CodeBlockContent>
              </CodeBlock>
            </CardContent>
            <CardFooter className="justify-end gap-2 pb-3">
              <Button size="sm" variant="outline" onClick={() => onDecide(pending.callId, false)}>
                Deny
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
