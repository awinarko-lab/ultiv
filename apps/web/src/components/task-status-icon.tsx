/** One icon per task status, shared by the task pill and the task cards. */
import type { TaskStatus } from "@ultiv/contracts";
import { CircleAlertIcon, CircleCheckIcon, CircleStopIcon, LoaderCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function TaskStatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const base = cn("size-4 shrink-0", className);
  if (status === "running")
    return (
      <LoaderCircleIcon
        aria-hidden
        className={cn(base, "text-primary animate-spin motion-reduce:animate-none")}
      />
    );
  if (status === "done")
    return (
      <CircleCheckIcon aria-hidden className={cn(base, "text-emerald-600 dark:text-emerald-400")} />
    );
  if (status === "failed")
    return <CircleAlertIcon aria-hidden className={cn(base, "text-destructive")} />;
  return <CircleStopIcon aria-hidden className={cn(base, "text-muted-foreground")} />;
}
