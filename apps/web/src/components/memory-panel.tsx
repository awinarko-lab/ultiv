/**
 * What a bot remembers (its profile-scope memory) plus the files it made.
 * Per-item delete is the point — the owner curates; the bot reads this store
 * plus the workspace-wide owner memory (not editable here — that store belongs
 * to the whole workspace). Human writes are always allowed (writer: null).
 */
import { DownloadIcon, PinIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DevDetails } from "@/components/ui/dev-details";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  api,
  type ArtifactRow,
  type MemoryV2Fact,
  type MemoryV2Line,
  type MemoryV2State,
} from "@/lib/api";
import { formatWhen } from "@/lib/format";

const formatBytes = (n: number): string =>
  n >= 1_048_576
    ? `${(n / 1_048_576).toFixed(1)} MB`
    : n >= 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${n} B`;

/** "text/markdown" -> "Markdown"; unknown types show their subtype. */
const KINDS: Record<string, string> = {
  "text/markdown": "Markdown",
  "text/plain": "Text",
  "text/html": "Web page",
  "text/csv": "Spreadsheet (CSV)",
  "application/json": "JSON",
  "application/pdf": "PDF",
};
const fileKind = (mime: string): string =>
  KINDS[mime] ?? (mime.startsWith("image/") ? "Image" : (mime.split("/")[1] ?? mime).toUpperCase());

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
  const [facts, setFacts] = useState<MemoryV2Fact[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [state, setState] = useState<{ key: string; value: string; updatedAt: number }[]>([]);
  const [v2, setV2] = useState<MemoryV2State | null>(null);
  const [draft, setDraft] = useState("");
  const [coreDraft, setCoreDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [files, kv, v2State] = await Promise.all([
        api.artifacts(profileId),
        api.stateOf(profileId),
        api.memoryV2(profileId),
      ]);
      setFacts(v2State.facts.filter((fact) => fact.status !== "forgotten"));
      setArtifacts(Array.isArray(files) ? files : []);
      setState(Array.isArray(kv) ? kv : []);
      setV2(v2State);
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children !== undefined && <DialogTrigger render={children} />}
      <DialogContent>
        <DialogTitle>What {name} remembers</DialogTitle>
        {error !== null && <p className="text-destructive mt-2 text-sm">{error}</p>}
        <div className="mt-3 flex flex-col gap-2">
          {facts.length === 0 && (
            <p className="text-muted-foreground text-sm">
              Nothing yet. Facts {name} keeps about its work show up here, and you can edit or
              delete them.
            </p>
          )}
          {facts.map((fact) => (
            <div
              key={fact.id}
              className="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words">{fact.text}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {formatWhen(fact.createdAt)}
                  {fact.tags.length > 0 && ` · ${fact.tags.join(", ")}`}
                  {fact.status !== "current" && ` · ${fact.status}`}
                  {fact.trust === "untrusted" && " · unverified"}
                </p>
              </div>
              <ConfirmDialog
                title="Forget this?"
                warning={`${name} will stop recalling it. It stays as a restorable tombstone until you purge.`}
                confirmLabel="Forget"
                onConfirm={async () => {
                  await api.memoryFactForget(fact.id, profileId);
                  await load();
                }}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Forget: ${fact.text.slice(0, 40)}`}
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
        <SectionHeader title="Core memory" />
        <p className="text-muted-foreground mt-1 text-xs">
          The few lines that sit in every prompt — always in context.
        </p>
        <div className="mt-2 flex flex-col gap-1.5">
          {(v2 === null ? [] : [...v2.core.owner, ...v2.core.profile]).length === 0 && (
            <p className="text-muted-foreground text-sm">
              Empty. Core lines are always in {name}'s context, so keep them short and few.
            </p>
          )}
          {(v2 === null ? [] : [...v2.core.owner, ...v2.core.profile]).map((line: MemoryV2Line) => (
            <div
              key={line.id}
              className="flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words">{line.text}</p>
                {line.pinned && (
                  <span className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
                    <PinIcon className="size-3" /> pinned
                  </span>
                )}
              </div>
              <ConfirmDialog
                title="Remove this core line?"
                warning="The bot stops seeing it from its next turn. This cannot be undone."
                onConfirm={async () => {
                  await api.memoryCoreRemove(line.id, profileId);
                  await load();
                }}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove core line: ${line.text.slice(0, 40)}`}
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
            if (coreDraft.trim() === "") return;
            setBusy(true);
            void api
              .memoryCoreAdd(coreDraft.trim(), profileId)
              .then(() => {
                setCoreDraft("");
                return load();
              })
              .finally(() => setBusy(false));
          }}
        >
          <Input
            className="flex-1"
            aria-label="A core line"
            placeholder="A short line always in context…"
            value={coreDraft}
            onChange={(event) => setCoreDraft(event.target.value)}
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={busy || coreDraft.trim() === ""}
          >
            Add
          </Button>
        </form>
        <Separator className="my-4" />
        <SectionHeader title="Tidy suggestions" />
        <p className="text-muted-foreground mt-1 text-xs">
          The Sunday tidy proposes; nothing changes until you accept.
        </p>
        <div className="mt-2 flex flex-col gap-2">
          {v2 !== null && v2.openCount > 0 && (
            <Badge variant="secondary" className="w-fit">
              <SparklesIcon className="size-3" /> {v2.openCount} open
            </Badge>
          )}
          {(v2?.proposals ?? []).filter((proposal) => proposal.status === "open").length === 0 && (
            <p className="text-muted-foreground text-sm">No suggestions right now.</p>
          )}
          {(v2?.proposals ?? [])
            .filter((proposal) => proposal.status === "open")
            .map((proposal) => (
              <div key={proposal.id} className="rounded-lg border px-2.5 py-2 text-sm">
                <p className="break-words">{proposal.summary}</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void api
                        .memoryProposalDecide(proposal.id, "accept", profileId)
                        .then(() => load());
                    }}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void api
                        .memoryProposalDecide(proposal.id, "reject", profileId)
                        .then(() => load());
                    }}
                  >
                    Not now
                  </Button>
                </div>
              </div>
            ))}
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void api.memoryTidyRun().then(() => load());
              }}
            >
              Run tidy now
            </Button>
            <ConfirmDialog
              title="Purge forgotten facts?"
              warning="Every forgotten fact loses its text for good. Tombstones stay, but the words are gone. This cannot be undone."
              confirmLabel="Purge"
              onConfirm={async () => {
                await api.memoryPurge(profileId);
                await load();
              }}
            >
              <Button variant="ghost" size="sm" className="text-destructive">
                Purge forgotten
              </Button>
            </ConfirmDialog>
          </div>
        </div>
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
                  <p className="text-muted-foreground truncate text-xs" title={row.value}>
                    {row.value}
                  </p>
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
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate" title={artifact.name}>
                    {artifact.name}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {fileKind(artifact.mime)} · {formatBytes(artifact.bytes)}
                  </span>
                </span>
                <a
                  href={api.artifactUrl(artifact.id)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Download ${artifact.name}`}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring/50 inline-flex size-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-3 pointer-coarse:size-11"
                >
                  <DownloadIcon className="size-4" />
                </a>
              </div>
            ))
          )}
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          {name} reads this store plus your workspace-wide memory. Forgetting an item hides it until
          you purge; the workspace-wide store is editable from any bot's panel.
        </p>
      </DialogContent>
    </Dialog>
  );
}
