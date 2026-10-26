/**
 * Confirmation for destructive actions. With `typed`, the user must type an
 * exact string (e.g. the bot's name) before the button unlocks — a purge with
 * cascade scope should not die to a stray click. Errors keep the dialog open
 * with the server's message so a failed delete never reads as success.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function ConfirmDialog({
  title,
  warning,
  confirmLabel = "Delete",
  typed,
  onConfirm,
  children,
}: {
  title: string;
  warning: string;
  confirmLabel?: string;
  /** When set, the user must type exactly this to enable the button. */
  typed?: string;
  onConfirm: () => Promise<void>;
  children: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = (typed === undefined || value === typed) && !busy;

  const close = (): void => {
    setOpen(false);
    setValue("");
    setError(null);
  };

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else setOpen(true);
      }}
    >
      <DialogTrigger render={children} />
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <p className="text-destructive mt-2 text-sm">{warning}</p>
        {typed !== undefined && (
          <label className="mt-2 flex flex-col gap-1 text-sm">
            Type <span className="font-mono font-semibold">{typed}</span> to confirm
            <Input value={value} onChange={(event) => setValue(event.target.value)} />
          </label>
        )}
        {error !== null && <p className="text-destructive mt-2 text-sm">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" disabled={!ready} onClick={() => void confirm()}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
