/**
 * One task in the expanded task pill: status, title (opens its activity),
 * elapsed time and what it is doing now. A running task has its own Stop with
 * a light inline confirm — no dialog for something this small.
 */
import { useState } from "react";
import type { TaskInfo } from "@ultiv/contracts";
import { Button } from "@/components/ui/button";
import { TaskActivityDialog } from "@/components/task-activity";
import { TaskStatusIcon } from "@/components/task-status-icon";
import { api } from "@/lib/api";
import { taskElapsed, taskLatest, taskStatusWord, taskTitle } from "@/lib/task-text";

function StopTask({ id, onStopped }: { id: string; onStopped: () => void }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = async (): Promise<void> => {
    try {
      await api.cancelTask(id);
      setAsking(false);
      onStopped();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  if (!asking)
    return (
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 pointer-coarse:min-h-11"
        onClick={() => setAsking(true)}
      >
        Stop
      </Button>
    );
  return (
    <span className="flex shrink-0 items-center gap-1">
      {error !== null && (
        <span role="alert" className="text-destructive text-xs">
          Couldn't stop
        </span>
      )}
      <Button
        variant="destructive"
        size="sm"
        className="pointer-coarse:min-h-11"
        onClick={() => void stop()}
      >
        Stop task
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="pointer-coarse:min-h-11"
        onClick={() => setAsking(false)}
      >
        Keep
      </Button>
    </span>
  );
}

export function TaskRow({
  task,
  now,
  onChanged,
}: {
  task: TaskInfo;
  now: number;
  onChanged: () => void;
}) {
  // Settled rows just say how it ended; the result is in the chat.
  const latest = task.status === "running" ? taskLatest(task) : undefined;
  return (
    <li className="flex items-center gap-2.5 rounded-2xl px-2.5 py-1.5">
      <TaskStatusIcon status={task.status} />
      <TaskActivityDialog task={task}>
        <button
          type="button"
          className="focus-visible:ring-ring/50 flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col justify-center rounded-lg text-left outline-none focus-visible:ring-3"
          title={task.prompt}
        >
          <span className="truncate text-sm font-medium">{taskTitle(task)}</span>
          <span className="text-muted-foreground truncate text-xs">
            {taskStatusWord(task.status)} · {taskElapsed(task, now)}
            {latest !== undefined && ` · ${latest}`}
          </span>
        </button>
      </TaskActivityDialog>
      {task.status === "running" && <StopTask id={task.id} onStopped={onChanged} />}
    </li>
  );
}
