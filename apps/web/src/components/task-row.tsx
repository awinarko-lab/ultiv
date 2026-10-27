/**
 * One task in the expanded task pill: status, title (opens its activity),
 * elapsed time and what it is doing now. A running task has its own Stop with
 * a light inline confirm — no dialog for something this small.
 */
import type { TaskInfo } from "@ultiv/contracts";
import { TaskActivityDialog } from "@/components/task-activity";
import { TaskStatusIcon } from "@/components/task-status-icon";
import { StopTask } from "@/components/task-sheet/stop-task";
import { taskElapsed, taskLatest, taskStatusWord, taskTitle } from "@/lib/task-text";

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
