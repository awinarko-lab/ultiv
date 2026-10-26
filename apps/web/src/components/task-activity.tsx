/**
 * The activity view of one background task: progress (its own conversation's
 * projected tail), the files it made, its result, and any approval waiting on
 * it — decide right here. Polls while open (REST has no push); cheap because
 * the endpoint returns a size-capped tail.
 */
import { useCallback, useEffect, useState } from "react";
import type { TaskInfo } from "@ultiv/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api, type ArtifactRow, type TaskActivity } from "@/lib/api";

const statusVariant = {
  running: "default",
  done: "secondary",
  failed: "destructive",
  cancelled: "outline",
} as const;

const kindLabel: Record<string, string> = {
  input: "you",
  output: "agent",
  thinking: "thinking",
  note: "note",
  tool: "tool",
};

export function TaskActivityDialog({
  task,
  children,
}: {
  task: TaskInfo;
  children: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [activity, setActivity] = useState<TaskActivity | null>(null);
  const [files, setFiles] = useState<ArtifactRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await api.taskActivity(task.id);
      setActivity(next);
      setFiles(next.conversationId !== null ? await api.artifactsFor(next.conversationId) : []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [task.id]);

  useEffect(() => {
    if (!open) return;
    void load();
    const timer = setInterval(() => void load(), 2_500);
    return () => clearInterval(timer);
  }, [open, load]);

  const decide = async (approved: boolean, always?: boolean, takeover?: boolean): Promise<void> => {
    const conversationId = activity?.conversationId;
    const callId = activity?.waiting?.callId;
    if (conversationId === null || conversationId === undefined || callId === undefined) return;
    try {
      await api.approvalDecide(conversationId, callId, approved, always, takeover);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children} />
      <DialogContent>
        <DialogTitle className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{task.prompt}</span>
          <Badge variant={statusVariant[task.status]}>{task.status}</Badge>
        </DialogTitle>
        {error !== null && <p className="text-destructive mt-2 text-sm">{error}</p>}

        {activity?.waiting !== null && activity?.waiting !== undefined && (
          <div className="border-destructive mt-3 rounded-md border px-3 py-2">
            <p className="text-destructive text-xs font-semibold uppercase">
              Waiting for you — {activity.waiting.name}
            </p>
            <pre className="text-muted-foreground mt-1 max-h-24 overflow-y-auto text-xs whitespace-pre-wrap">
              {JSON.stringify(activity.waiting.input, null, 2)}
            </pre>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <Button
                size="xs"
                variant="ghost"
                className="text-destructive"
                onClick={() => void decide(false, undefined, true)}
              >
                Take over
              </Button>
              <Button size="xs" variant="outline" onClick={() => void decide(false)}>
                Deny
              </Button>
              <Button size="xs" variant="secondary" onClick={() => void decide(true, true)}>
                Always allow
              </Button>
              <Button size="xs" onClick={() => void decide(true)}>
                Approve
              </Button>
            </div>
          </div>
        )}

        <div className="mt-3 max-h-64 overflow-y-auto rounded-md border px-3 py-2">
          {activity === null ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : activity.steps.length === 0 ? (
            <p className="text-muted-foreground text-sm">No activity yet.</p>
          ) : (
            activity.steps.map((step, index) => (
              <p
                key={`${step.at}-${index}`}
                className="border-muted/40 border-b py-1.5 text-xs last:border-b-0"
              >
                <span className="text-muted-foreground mr-2 inline-block w-14 font-semibold">
                  {kindLabel[step.kind] ?? step.kind}
                </span>
                <span className="break-words">{step.text}</span>
              </p>
            ))
          )}
        </div>

        {(task.status === "done" || task.status === "failed") && (
          <div className="mt-3 rounded-md border px-3 py-2 text-sm">
            <p className="text-xs font-semibold uppercase">
              {task.status === "done" ? "Result" : "Failed"}
            </p>
            <p className="mt-1 break-words whitespace-pre-wrap">
              {task.status === "done"
                ? (task.result ?? "Finished without a result text.")
                : (task.error ?? "Unknown failure.")}
            </p>
          </div>
        )}

        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground">Files from this task</p>
          <div className="mt-2 flex flex-col gap-1.5">
            {files.length === 0 ? (
              <p className="text-muted-foreground text-xs">None yet.</p>
            ) : (
              files.map((file) => (
                <a
                  key={file.id}
                  href={api.artifactUrl(file.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:bg-muted flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <Badge variant="outline">{file.mime}</Badge>
                </a>
              ))
            )}
          </div>
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          Created {new Date(task.createdAt).toLocaleString()}
          {task.finishedAt !== null && ` · finished ${new Date(task.finishedAt).toLocaleString()}`}
        </p>
      </DialogContent>
    </Dialog>
  );
}
