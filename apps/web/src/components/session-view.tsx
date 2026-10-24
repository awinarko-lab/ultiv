import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Phase, TranscriptEntry } from "@ultiv/contracts";
import { BrainIcon, CircleAlertIcon, WrenchIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { Input } from "@/components/ui/input";
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

/** Agent output is markdown; the newest block streams with a caret while working. */
function Output({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
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

/** Tool call as a Trace step: name + duration, collapsible input/output. */
function Tool({
  name,
  status,
  input,
  output,
  durationMs,
}: {
  name: string;
  status: "running" | "done" | "error";
  input: unknown;
  output: string | null;
  durationMs: number | null;
}) {
  const lineStatus = status === "running" || status === "error" ? { status } : {};
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine {...lineStatus}>
            <TraceIcon>{status === "error" ? <CircleAlertIcon /> : <WrenchIcon />}</TraceIcon>
            <TraceTitle>{name}</TraceTitle>
            <TraceDescription>
              {durationMs === null ? "running…" : `${durationMs} ms`}
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div className="flex flex-col gap-2">
            <CodeBlock size="sm">
              <CodeBlockHeader>
                <CodeBlockTitle>input</CodeBlockTitle>
              </CodeBlockHeader>
              <CodeBlockContent wrap>{JSON.stringify(input, null, 2)}</CodeBlockContent>
            </CodeBlock>
            {output !== null && output !== "" && (
              <CodeBlock size="sm">
                <CodeBlockHeader>
                  <CodeBlockTitle>output</CodeBlockTitle>
                </CodeBlockHeader>
                <CodeBlockContent wrap>{output}</CodeBlockContent>
              </CodeBlock>
            )}
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

export function SessionView({
  link,
  transcript,
  phase,
  lastError,
  onInput,
}: {
  link: "connecting" | "live" | "lost";
  transcript: TranscriptEntry[];
  phase: Phase;
  lastError: string | null;
  onInput: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const busy = phase === "working";

  // Pin the transcript to the newest entry: on open, on every turn.
  useEffect(() => {
    const viewport = transcriptRef.current?.querySelector("[data-slot=scroll-area-viewport]");
    if (viewport === null || viewport === undefined) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [transcript, busy]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === "" || busy) return;
    onInput(text);
    setDraft("");
  };

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader>
        <CardTitle>Transcript</CardTitle>
        <Badge variant={link === "live" ? "secondary" : "outline"}>{link}</Badge>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        <div ref={transcriptRef} className="h-full min-h-0">
          <ScrollArea className="h-full">
            <ul className="flex flex-col gap-3 pr-3">
              {transcript.map((entry) => {
                if (entry.kind === "input") {
                  return (
                    <li key={entry.id} className={roleStyles.user}>
                      {entry.text}
                    </li>
                  );
                }
                if (entry.kind === "output") {
                  return (
                    <li key={entry.id} className={roleStyles.agent}>
                      <Output text={entry.text} streaming={entry.streaming} />
                    </li>
                  );
                }
                if (entry.kind === "thinking") {
                  return (
                    <li key={entry.id} className="w-full">
                      <Thinking text={entry.text} />
                    </li>
                  );
                }
                return (
                  <li key={entry.id} className="w-full">
                    <Tool
                      name={entry.step.name}
                      status={entry.step.status}
                      input={entry.step.input}
                      output={entry.step.output}
                      durationMs={entry.step.durationMs}
                    />
                  </li>
                );
              })}
              {busy && !transcript.some((entry) => entry.kind === "output" && entry.streaming) && (
                <li className="self-start text-sm text-muted-foreground">working…</li>
              )}
            </ul>
          </ScrollArea>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        {lastError !== null && <p className="w-full text-sm text-destructive">{lastError}</p>}
        <form className="flex w-full gap-2" onSubmit={submit}>
          <Input
            placeholder={link === "live" ? "Give the agent a task…" : "Waiting for link…"}
            value={draft}
            disabled={link !== "live"}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" disabled={link !== "live" || busy}>
            Run
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
