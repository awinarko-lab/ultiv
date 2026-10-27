/**
 * The transcript body: markdown output, collapsed reasoning, tool traces and
 * machinery notes, grouped so consecutive tool steps read as one sequence.
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ToolStep, TranscriptEntry } from "@ultiv/contracts";
import { BrainIcon, CircleAlertIcon, WrenchIcon } from "lucide-react";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block";
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

/** Short timestamp: HH:MM, with the date when the entry isn't from today. */
const stampOf = (at: number): string => {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? time
    : `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
};

/**
 * Bracketed machinery notes: the header ([relay • topic], [reply from …],
 * "✉ → peer (kind)") renders as a small caption, the rest as the body.
 */
const noteParts = (text: string): { header: string; body: string } => {
  const firstBreak = text.indexOf("\n");
  if (text.startsWith("[") || text.startsWith("✉")) {
    const headerEnd = text.indexOf("]");
    if (text.startsWith("✉")) {
      const header = firstBreak > 0 ? text.slice(0, firstBreak) : text;
      return { header, body: firstBreak > 0 ? text.slice(firstBreak + 1).trim() : "" };
    }
    if (headerEnd > 0) {
      return { header: text.slice(1, headerEnd), body: text.slice(headerEnd + 1).trim() };
    }
  }
  return { header: "note", body: text };
};
const noteHeader = (text: string): string => noteParts(text).header;
const noteBody = (text: string): string => {
  const { header, body } = noteParts(text);
  return body === "" ? header : body;
};

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

/** Every transcript entry, in order, as list items. */
export function TranscriptItems({ transcript }: { transcript: TranscriptEntry[] }) {
  return (
    <>
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
            <span className="text-muted-foreground ml-2 align-baseline text-[10px]">
              {stampOf(group.entry.at)}
            </span>
          </li>
        ) : group.entry.kind === "output" ? (
          <li key={group.key} className={roleStyles.agent}>
            <Output text={group.entry.text} streaming={group.entry.streaming} />
            <span className="text-muted-foreground ml-2 align-baseline text-[10px]">
              {stampOf(group.entry.at)}
            </span>
          </li>
        ) : group.entry.kind === "thinking" ? (
          <li key={group.key} className="w-full">
            <Thinking text={group.entry.text} />
          </li>
        ) : group.entry.kind === "note" ? (
          <li
            key={group.key}
            className="bg-muted/40 text-muted-foreground w-full rounded-md border px-3 py-2 text-sm"
          >
            <span className="text-foreground/70 text-xs font-semibold uppercase">
              {noteHeader(group.entry.text)}{" "}
              <span className="font-normal">{stampOf(group.entry.at)}</span>
            </span>
            <div className="max-h-64 overflow-y-auto break-words [&_p:first-child]:mt-1 [&_p:last-child]:mb-0">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {noteBody(group.entry.text)}
              </ReactMarkdown>
            </div>
          </li>
        ) : null,
      )}
    </>
  );
}
