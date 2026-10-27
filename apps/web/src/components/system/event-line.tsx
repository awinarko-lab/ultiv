/**
 * Slim one-line system events: a scheduled run, something a sensor noticed,
 * a task's progress update, or the owner's own room note.
 */
import { ActivityIcon, CalendarClockIcon, EyeIcon } from "lucide-react";
import { formatClock, formatFull } from "@/lib/format";
import { cn } from "@/lib/utils";
import { enter } from "./card-shell";

export function EventLine({
  kind,
  text,
  at,
  label,
}: {
  kind: "cron" | "sensor" | "update" | "quiet";
  text: string;
  at: number;
  /** Who it's about: the task's title (or the sensor's source, in the tooltip). */
  label?: string | undefined;
}) {
  const Icon = kind === "cron" ? CalendarClockIcon : kind === "sensor" ? EyeIcon : ActivityIcon;
  const lead =
    kind === "cron"
      ? "Scheduled:"
      : kind === "sensor"
        ? "Noticed:"
        : kind === "update"
          ? `${label ?? "Task"}:`
          : "Your note:";
  return (
    <p
      className={cn(
        "text-muted-foreground flex w-full min-w-0 items-start gap-2 px-1 text-xs leading-5",
        kind === "quiet" && "justify-end",
        enter,
      )}
      title={
        kind === "sensor" && label !== undefined ? `${label} · ${formatFull(at)}` : formatFull(at)
      }
    >
      {kind !== "quiet" && <Icon aria-hidden className="mt-0.75 size-3.5 shrink-0" />}
      <span className="line-clamp-2 min-w-0 flex-1 break-words">
        <span className="text-foreground/80 font-medium">{lead}</span> {text}
      </span>
      <span className="shrink-0 tabular-nums">· {formatClock(at)}</span>
    </p>
  );
}
