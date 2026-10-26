/**
 * What a bot remembers (its profile-scope memory) plus the files it made.
 * Per-item delete is the point — the owner curates; the bot reads this store
 * plus the workspace-wide owner memory (not editable here — that store belongs
 * to the whole workspace). Human writes are always allowed (writer: null).
 */
import { DownloadIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { MemoryRecord } from "@ultiv/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { api, type ArtifactRow } from "@/lib/api";

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
}: {
  profileId: string;
  name: string;
  children: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
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

  const remove = async (recordId: string): Promise<void> => {
    try {
      await api.profileMemoryRemove(profileId, recordId);
      setRecords((rows) => rows.filter((row) => row.id !== recordId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children} />
      <DialogContent>
        <DialogTitle>What {name} remembers</DialogTitle>
        {error !== null && <p className="text-destructive mt-2 text-sm">{error}</p>}
        <div className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto">
          {records.length === 0 && (
            <p className="text-muted-foreground text-sm">
              Nothing yet — durable facts {name} keeps about its work appear here, editable and
              deletable.
            </p>
          )}
          {records.map((record) => (
            <div
              key={record.id}
              className="flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words">{record.text}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {new Date(record.at).toLocaleString()}
                  {record.tags.length > 0 && ` · ${record.tags.join(", ")}`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Forget: ${record.text.slice(0, 40)}`}
                onClick={() => void remove(record.id)}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Input
            className="flex-1"
            placeholder={`Something ${name} should always know…`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy || draft.trim() === ""}
            onClick={() => void add()}
          >
            {busy ? "Saving…" : "Remember"}
          </Button>
        </div>
        <Separator className="my-4" />
        <p className="text-xs font-medium text-muted-foreground">Durable state (KV)</p>
        <div className="mt-2 flex max-h-56 flex-col gap-2 overflow-y-auto">
          {state.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No KV state yet — the bot's dedup ledgers and "already acted" markers live here
              (state_get / state_set).
            </p>
          ) : (
            state.map((row) => (
              <div
                key={row.key}
                className="flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <code className="text-xs">{row.key}</code>
                  <p className="text-muted-foreground truncate text-xs">{row.value}</p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(row.updatedAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete state ${row.key}`}
                  onClick={() => {
                    void api.removeState(profileId, row.key).then(() => {
                      void load();
                    });
                  }}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))
          )}
        </div>
        <Separator className="my-4" />
        <p className="text-xs font-medium text-muted-foreground">Files {name} made</p>
        <div className="mt-2 flex max-h-56 flex-col gap-2 overflow-y-auto">
          {artifacts.length === 0 ? (
            <p className="text-muted-foreground text-sm">No artifacts yet.</p>
          ) : (
            artifacts.map((artifact) => (
              <div
                key={artifact.id}
                className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
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
