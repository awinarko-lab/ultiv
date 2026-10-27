/**
 * The task's steps as a compact vertical timeline: one friendly line per tool
 * call (tap for the raw call, pretty-printed and truncated), thinking folded
 * to "Thought for a moment", bot messages as normal text. The newest step
 * pulses while the task runs (still under reduced motion).
 */
import { useId, useState } from "react";
import {
  BookmarkIcon,
  ChevronDownIcon,
  ClockIcon,
  FileTextIcon,
  GlobeIcon,
  KeyRoundIcon,
  LightbulbIcon,
  ListChecksIcon,
  type LucideIcon,
  MegaphoneIcon,
  MessageSquareIcon,
  PlugIcon,
  SearchIcon,
  SendIcon,
  TerminalIcon,
  UserIcon,
  WrenchIcon,
} from "lucide-react";
import { LazyMarkdown } from "@/components/lazy-markdown";
import { formatDuration, type TimelineItem, type ToolIcon } from "@/lib/task-steps";
import { cn } from "@/lib/utils";
import { Payload } from "./payload";

const TOOL_ICON: Record<ToolIcon, LucideIcon> = {
  clock: ClockIcon,
  search: SearchIcon,
  page: GlobeIcon,
  file: FileTextIcon,
  memory: BookmarkIcon,
  terminal: TerminalIcon,
  message: SendIcon,
  task: ListChecksIcon,
  plug: PlugIcon,
  key: KeyRoundIcon,
  tool: WrenchIcon,
};

const KIND_ICON = {
  thinking: LightbulbIcon,
  message: MessageSquareIcon,
  note: MegaphoneIcon,
  input: UserIcon,
} as const;

function Dot({ icon: Icon, live, error }: { icon: LucideIcon; live: boolean; error: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-muted text-muted-foreground absolute top-2.5 left-0 flex size-6 items-center justify-center rounded-full",
        live && "bg-primary/15 text-primary ring-primary/40 ring-2 motion-safe:animate-pulse",
        error && "bg-destructive/10 text-destructive",
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

/** A row that folds open: the summary line is the 44px button. */
function Fold({
  summary,
  meta,
  muted,
  children,
}: {
  summary: string;
  meta?: string | null | undefined;
  muted?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="focus-visible:ring-ring/50 hover:bg-muted/50 -mx-2 flex min-h-11 w-[calc(100%+1rem)] cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm outline-none focus-visible:ring-3"
      >
        <span className={cn("min-w-0 flex-1 break-words", muted && "text-muted-foreground")}>
          {summary}
        </span>
        {meta !== null && meta !== undefined && (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{meta}</span>
        )}
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div id={id} className="pb-2">
          {children}
        </div>
      )}
    </>
  );
}

function ToolBody({ item }: { item: Extract<TimelineItem, { kind: "tool" }> }) {
  if (item.input === null && item.output === null)
    return <p className="text-muted-foreground text-xs">No details.</p>;
  return (
    <div className="flex flex-col gap-2">
      {item.input !== null && <Payload label="Sent" text={item.input} />}
      {item.output !== null && <Payload label="Got back" text={item.output} />}
    </div>
  );
}

function Step({ item, live }: { item: TimelineItem; live: boolean }) {
  if (item.kind === "tool") {
    const meta = item.status === "running" ? "working…" : formatDuration(item.durationMs);
    return (
      <>
        <Dot icon={TOOL_ICON[item.icon]} live={live} error={item.status === "error"} />
        <Fold summary={item.status === "error" ? `${item.line} — failed` : item.line} meta={meta}>
          <ToolBody item={item} />
        </Fold>
      </>
    );
  }
  const icon = KIND_ICON[item.kind];
  if (item.kind === "thinking")
    return (
      <>
        <Dot icon={icon} live={live} error={false} />
        <Fold summary={live ? "Thinking…" : "Thought for a moment"} muted>
          <p className="text-muted-foreground text-sm break-words whitespace-pre-wrap">
            {item.text}
          </p>
        </Fold>
      </>
    );
  return (
    <>
      <Dot icon={icon} live={live} error={false} />
      <div className="py-2.5 text-sm break-words">
        {item.kind === "note" && <span className="text-muted-foreground">Update: </span>}
        {item.kind === "input" && <span className="text-muted-foreground">You: </span>}
        {item.kind === "message" ? (
          <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <LazyMarkdown text={item.text} />
          </div>
        ) : (
          <span className="whitespace-pre-wrap">{item.text}</span>
        )}
      </div>
    </>
  );
}

export function Timeline({ items, running }: { items: readonly TimelineItem[]; running: boolean }) {
  if (items.length === 0)
    return (
      <p className="text-muted-foreground py-2 text-sm">
        {running ? "Getting started…" : "No steps to show."}
      </p>
    );
  return (
    <ol aria-label="Steps" className="flex flex-col">
      {items.map((item, index) => (
        <li
          key={item.key}
          className="before:bg-border relative pl-9 before:absolute before:top-9 before:bottom-0 before:left-3 before:w-px last:before:hidden"
        >
          <Step item={item} live={running && index === items.length - 1} />
        </li>
      ))}
    </ol>
  );
}
