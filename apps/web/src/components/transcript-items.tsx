/**
 * The transcript body: markdown output, collapsed reasoning, tool traces and
 * machinery notes, grouped so consecutive tool steps read as one sequence.
 */
import { memo } from "react";
import { formatDivider, formatFull } from "@/lib/format";
import type { ToolStep, TranscriptEntry } from "@ultiv/contracts";
import { BrainIcon, CircleAlertIcon, WrenchIcon } from "lucide-react";
import { Markdown } from "@/components/markdown";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockCopyButton,
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

// Messenger bubbles: the owner on the right in the muted surface, the bot on
// the left in a lighter one (a hairline keeps it visible on white).
const roleStyles = {
  user: "self-end max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 leading-relaxed whitespace-pre-wrap break-words",
  agent:
    "min-w-0 max-w-full rounded-2xl bg-muted/40 px-4 py-2.5 border border-border/60 dark:border-transparent",
} as const;

/** A new divider when this much time passed since the previous message. */
const DIVIDER_GAP_MS = 10 * 60_000;

/**
 * Bot output is markdown; the newest block streams with a caret (still under
 * reduced motion). Finished messages get a copy action under the bubble.
 * Memoised: only the message whose text changes re-renders while streaming.
 */
const Output = memo(function Output({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <>
      <div className={roleStyles.agent}>
        <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1.5 [&_hr]:my-3 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_h1]:mt-3 [&_h2]:mt-3 [&_h3]:mt-2 [&_pre]:my-2">
          <Markdown text={text} />
          {streaming && (
            <span aria-hidden className="motion-safe:animate-pulse">
              ▍
            </span>
          )}
        </div>
      </div>
      {!streaming && (
        <div className="opacity-0 transition-opacity group-focus-within/msg:opacity-100 group-hover/msg:opacity-100 pointer-coarse:opacity-100">
          <CodeBlockCopyButton
            value={text}
            aria-label="Copy message"
            className="text-muted-foreground"
          />
        </div>
      )}
    </>
  );
});

/** Reasoning as a collapsed Trace step: "Thinking…" while live, then past tense. */
const Thinking = memo(function Thinking({ text, live }: { text: string; live: boolean }) {
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <BrainIcon />
            </TraceIcon>
            <TraceTitle>{live ? "Thinking…" : "Thought for a moment"}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <p className="text-sm whitespace-pre-wrap italic">{text}</p>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
});

/** Tool call as a Trace line: name + duration, collapsible input/output. */
const Tool = memo(function Tool({ step }: { step: ToolStep }) {
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
});

/** A machinery note: small caption + markdown body. */
const Note = memo(function Note({ text }: { text: string }) {
  return (
    <>
      <span className="text-foreground/70 text-xs font-medium">{noteHeader(text)}</span>
      <div className="max-h-64 overflow-y-auto break-words [&_p:first-child]:mt-1 [&_p:last-child]:mb-0">
        <Markdown text={noteBody(text)} />
      </div>
    </>
  );
});

/** Consecutive tool steps render as one Trace so a run reads as a sequence. */
type Group =
  | { key: string; at: number; tools: ToolStep[] }
  | { key: string; at: number; entry: TranscriptEntry };

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
      groups.push({ key: String(entry.id), at: entry.at, tools: [entry.step] });
      continue;
    }
    groups.push({ key: String(entry.id), at: entry.at, entry });
  }
  return groups;
}

/** Every transcript entry, in order, as list items. busy marks the last reasoning as live. */
export function TranscriptItems({
  transcript,
  busy = false,
}: {
  transcript: TranscriptEntry[];
  busy?: boolean;
}) {
  return (
    <>
      {groupTranscript(transcript).map((group, index, groups) => {
        const previous = groups[index - 1];
        const divider =
          previous === undefined || group.at - previous.at >= DIVIDER_GAP_MS ? (
            <li
              key={`divider-${group.key}`}
              role="separator"
              className="text-muted-foreground self-center py-1 text-xs"
            >
              {formatDivider(group.at)}
            </li>
          ) : null;
        return [divider, renderGroup(group, busy && index === groups.length - 1)];
      })}
    </>
  );
}

function renderGroup(group: Group, last: boolean) {
  return "tools" in group ? (
    <li key={group.key} className="w-full">
      <Trace>
        {group.tools.map((step) => (
          <Tool key={step.callId} step={step} />
        ))}
      </Trace>
    </li>
  ) : group.entry.kind === "input" ? (
    <li key={group.key} className={roleStyles.user} title={formatFull(group.entry.at)}>
      {group.entry.text}
    </li>
  ) : group.entry.kind === "output" ? (
    <li
      key={group.key}
      className="group/msg flex max-w-[80%] min-w-0 flex-col items-start gap-0.5 self-start"
      title={formatFull(group.entry.at)}
    >
      <Output text={group.entry.text} streaming={group.entry.streaming} />
    </li>
  ) : group.entry.kind === "thinking" ? (
    <li key={group.key} className="w-full">
      <Thinking text={group.entry.text} live={last} />
    </li>
  ) : group.entry.kind === "note" ? (
    <li
      key={group.key}
      className="bg-muted/30 text-muted-foreground w-full rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
      title={formatFull(group.entry.at)}
    >
      <Note text={group.entry.text} />
    </li>
  ) : null;
}
