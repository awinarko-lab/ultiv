/**
 * Files tab: the artifacts the bot made (downloads) and the "already handled"
 * key-value state it uses to not redo work.
 */
import { DownloadIcon, Trash2Icon } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { DevDetails } from "@/components/ui/dev-details";
import type { MemoryData } from "@/components/memory/memory-panel";
import { api } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import * as t from "@/lib/memory-text";

interface TabProps {
  data: MemoryData;
  profileId: string;
  name: string;
  reload: () => Promise<void>;
}

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
const formatBytes = (n: number): string =>
  n >= 1_048_576
    ? `${(n / 1_048_576).toFixed(1)} MB`
    : n >= 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${n} B`;

export function FilesTab({ data, profileId, name, reload }: TabProps) {
  return (
    <>
      <SectionHeader title={`Files ${name} made`} />
      <div className="flex flex-col gap-2">
        {data.artifacts.length === 0 ? (
          <EmptyState>{t.filesEmpty}</EmptyState>
        ) : (
          data.artifacts.map((artifact) => (
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
                aria-label={t.downloadAria(artifact.name)}
                className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring/50 inline-flex size-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-3 pointer-coarse:size-11"
              >
                <DownloadIcon className="size-4" />
              </a>
            </div>
          ))
        )}
      </div>
      <SectionHeader title="Already handled" className="mt-2" />
      <div className="flex flex-col gap-2">
        {data.kv.length === 0 ? (
          <EmptyState>{t.kvEmpty(name)}</EmptyState>
        ) : (
          data.kv.map((row) => (
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
                warning={t.kvDeleteWarning(name)}
                onConfirm={async () => {
                  await api.removeState(profileId, row.key);
                  await reload();
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
    </>
  );
}
