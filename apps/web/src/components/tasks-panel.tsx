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
    } catch {
      // REST hiccup: keep the last known list.
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
