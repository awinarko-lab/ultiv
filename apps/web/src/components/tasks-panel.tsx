import { useCallback, useEffect, useState } from "react";
import type { TaskInfo } from "@ultiv/contracts";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const statusVariant = {
  running: "default",
  done: "secondary",
  failed: "destructive",
  cancelled: "outline",
} as const;

/**
 * Background tasks for this session (plus the agent's own), polled — REST has
 * no push. Stop removes a running task (it is cancelled first and the agent
 * is told); Delete drops settled rows.
 */
export function TasksPanel({ sessionId }: { sessionId: string }) {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);

  const refresh = useCallback(async () => {
    try {
      const all = await api.tasks();
      setTasks(
        all.filter(
          (task) =>
            task.sessionId === sessionId || (task.owner === "agent" && task.sessionId === ""),
        ),
      );
    } catch {
      // REST hiccup: keep the last known list.
    }
  }, [sessionId]);

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
      await api.removeTask(id);
      void refresh();
    },
    [refresh],
  );

  if (tasks.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">Background tasks</p>
      <ul className="flex flex-col gap-1">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="flex items-center gap-2 rounded-md border bg-card/50 px-2.5 py-1.5 text-xs"
          >
            <Badge variant={statusVariant[task.status]}>{task.status}</Badge>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {task.prompt.slice(0, 90)}
            </span>
            {task.status === "running" ? (
              <Button variant="outline" size="xs" onClick={() => void remove(task.id)}>
                Stop
              </Button>
            ) : (
              <Button variant="ghost" size="xs" onClick={() => void remove(task.id)}>
                Delete
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
