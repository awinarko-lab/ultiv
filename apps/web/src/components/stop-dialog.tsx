/**
 * Stop with tasks running: the chat's Stop asks whether its background tasks
 * stop too. Three plain choices — stop everything, stop only the reply, or
 * keep going. Without running tasks Stop never asks.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export function StopDialog({
  open,
  running,
  onOpenChange,
  onStop,
}: {
  open: boolean;
  running: number;
  onOpenChange: (open: boolean) => void;
  /** `tasks`: also stop this chat's running tasks. */
  onStop: (tasks: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = async (tasks: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onStop(tasks);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const noun = running === 1 ? "task" : "tasks";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>
          Stop {running === 1 ? "the" : running} running {noun} too?
        </DialogTitle>
        <p className="text-muted-foreground mt-2 text-sm">
          The reply stops either way. Stopped tasks don't report back.
        </p>
        {error !== null && <p className="text-destructive mt-2 text-sm">{error}</p>}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            variant="destructive"
            className="pointer-coarse:min-h-11"
            disabled={busy}
            onClick={() => void stop(true)}
          >
            Stop reply and {noun}
          </Button>
          <Button
            variant="outline"
            className="pointer-coarse:min-h-11"
            disabled={busy}
            onClick={() => void stop(false)}
          >
            Stop reply only
          </Button>
          <Button
            variant="ghost"
            className="pointer-coarse:min-h-11 sm:mr-auto"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Keep going
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
