import { useCallback, useEffect, useState } from "react";
import type { TaskInfo } from "@ultiv/contracts";
import { api } from "@/lib/api";
import { pollFailed, pollRecovered } from "@/lib/notify";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TaskActivityDialog } from "@/components/task-activity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const statusVariant = {
  running: "default",
  done: "secondary",
  failed: "destructive",
  cancelled: "outline",
} as const;

/**
 * Background tasks of THIS conversation, polled — REST has no push. The panel
 * stays hidden until the session's conversation id is known, so nothing from
 * other conversations leaks in. Stop removes a running task (it is cancelled
 * first and the agent is told); Delete drops settled rows. Failures surface
 * instead of silently doing nothing.
 */
export function TasksPanel({ conversationId }: { conversationId: string | null }) {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (conversationId === null) return;
    try {
      const all = await api.tasks();
      setTasks(all.filter((task) => task.conversationId === conversationId));
      pollRecovered("tasks-poll");
    } catch (cause) {
      // Keep the last known list, but say it may be stale (one toast, not one per poll).
      pollFailed("tasks-poll", "Background tasks may be out of date", cause);
    }
  }, [conversationId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3_000);
    const onFocus = (): void => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.removeTask(id);
        setError(null);
        void refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [refresh],
  );

  if (conversationId === null || tasks.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">Background tasks</p>
      {error !== null && <p className="text-destructive text-xs">{error}</p>}
      <ul className="flex flex-col gap-1">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="flex items-center gap-2 rounded-md border bg-card/50 px-2.5 py-1.5 text-xs"
          >
            <Badge variant={statusVariant[task.status]}>{task.status}</Badge>
            <TaskActivityDialog task={task}>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground min-w-0 flex-1 cursor-pointer truncate text-left"
                title={task.prompt}
              >
                {task.prompt.slice(0, 90)}
              </button>
            </TaskActivityDialog>
            {task.status === "running" ? (
              <Button variant="outline" size="xs" onClick={() => void remove(task.id)}>
                Stop
              </Button>
            ) : (
              <ConfirmDialog
                title="Delete this task?"
                warning="Its record and activity log are removed. This cannot be undone."
                onConfirm={async () => {
                  await api.removeTask(task.id);
                  void refresh();
                }}
              >
                <Button variant="ghost" size="xs">
                  Delete
                </Button>
              </ConfirmDialog>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
