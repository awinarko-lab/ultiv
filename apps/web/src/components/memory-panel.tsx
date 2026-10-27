/**
 * What a bot remembers (its profile-scope memory) plus the files it made.
 * Per-item delete is the point — the owner curates; the bot reads this store
 * plus the workspace-wide owner memory (not editable here — that store belongs
 * to the whole workspace). Human writes are always allowed (writer: null).
 */
import { DownloadIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { MemoryRecord } from "@ultiv/contracts";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { DevDetails } from "@/components/ui/dev-details";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { api, type ArtifactRow } from "@/lib/api";
import { formatWhen } from "@/lib/format";

const formatBytes = (n: number): string =>
  n >= 1_048_576
    ? `${(n / 1_048_576).toFixed(1)} MB`
    : n >= 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${n} B`;

export function MemoryPanel({
  profileId,
  name,
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  profileId: string;
  name: string;
  /** The trigger; omit it and drive `open` instead (e.g. from a menu item). */
  children?: React.ReactElement | undefined;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (next: boolean): void => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [state, setState] = useState<{ key: string; value: string; updatedAt: number }[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [memory, files, kv] = await Promise.all([
        api.profileMemory(profileId),
        api.artifacts(profileId),
        api.stateOf(profileId),
      ]);
      setRecords(Array.isArray(memory) ? memory : []);
      setArtifacts(Array.isArray(files) ? files : []);
      setState(Array.isArray(kv) ? kv : []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [profileId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const add = async (): Promise<void> => {
    if (draft.trim() === "") return;
    setBusy(true);
    try {
      await api.profileMemoryAdd(profileId, draft.trim());
      setDraft("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  // Throws on failure — the confirm dialog stays open and shows the reason.
  const remove = async (recordId: string): Promise<void> => {
    await api.profileMemoryRemove(profileId, recordId);
    setRecords((rows) => rows.filter((row) => row.id !== recordId));
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children !== undefined && <DialogTrigger render={children} />}
      <DialogContent>
        <DialogTitle>What {name} remembers</DialogTitle>
        {error !== null && <p className="text-destructive mt-2 text-sm">{error}</p>}
        <div className="mt-3 flex flex-col gap-2">
          {records.length === 0 && (
            <p className="text-muted-foreground text-sm">
              Nothing yet. Facts {name} keeps about its work show up here, and you can edit or
              delete them.
            </p>
          )}
          {records.map((record) => (
            <div
              key={record.id}
              className="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words">{record.text}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {formatWhen(record.at)}
                  {record.tags.length > 0 && ` · ${record.tags.join(", ")}`}
                </p>
              </div>
              <ConfirmDialog
                title="Forget this?"
                warning={`${name} will no longer remember it. This cannot be undone.`}
                confirmLabel="Forget"
                onConfirm={() => remove(record.id)}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Forget: ${record.text.slice(0, 40)}`}
                >
                  <Trash2Icon />
                </Button>
              </ConfirmDialog>
            </div>
          ))}
        </div>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Input
            className="flex-1"
            aria-label={`Something ${name} should always know`}
            placeholder={`Something ${name} should always know…`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" variant="outline" size="sm" disabled={busy || draft.trim() === ""}>
            {busy ? "Saving…" : "Remember"}
          </Button>
        </form>
        <Separator className="my-4" />
        <SectionHeader title="Already handled" />
        <div className="mt-2 flex flex-col gap-2">
          {state.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing yet. {name} notes what it has already done here, so it doesn't do it twice.
            </p>
          ) : (
            state.map((row) => (
              <div
                key={row.key}
                className="flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <code className="text-xs">{row.key}</code>
                  <p className="text-muted-foreground truncate text-xs">{row.value}</p>
                  <p className="text-muted-foreground text-xs">{formatWhen(row.updatedAt)}</p>
                </div>
                <ConfirmDialog
                  title={`Delete ${row.key}?`}
                  warning={`${name} may redo work this marker was guarding against. This cannot be undone.`}
                  onConfirm={async () => {
                    await api.removeState(profileId, row.key);
                    await load();
                  }}
                >
                  <Button variant="ghost" size="icon" aria-label={`Delete ${row.key}`}>
                    <Trash2Icon />
                  </Button>
                </ConfirmDialog>
              </div>
            ))
          )}
        </div>
        <DevDetails className="mt-2">
          Key-value state the bot reads and writes with state_get and state_set.
        </DevDetails>
        <Separator className="my-4" />
        <SectionHeader title={`Files ${name} made`} />
        <div className="mt-2 flex flex-col gap-2">
          {artifacts.length === 0 ? (
            <p className="text-muted-foreground text-sm">No files yet.</p>
          ) : (
            artifacts.map((artifact) => (
              <div
                key={artifact.id}
                className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{artifact.name}</span>
                <Badge variant="outline">{artifact.mime}</Badge>
                <span className="text-muted-foreground text-xs">{formatBytes(artifact.bytes)}</span>
                <a
                  href={api.artifactUrl(artifact.id)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Download ${artifact.name}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <DownloadIcon className="size-4" />
                </a>
              </div>
            ))
          )}
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          {name} reads this store plus your workspace-wide memory. Deleting an item here is
          immediate.
        </p>
      </DialogContent>
    </Dialog>
  );
}
