/**
 * Core tab: the few lines that sit in every prompt, plus the add form.
 * Core CRUD is the owner's; bots cannot edit pinned lines.
 */
import { PinIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MemoryData } from "@/components/memory/memory-panel";
import { api, type MemoryV2Line } from "@/lib/api";
import * as t from "@/lib/memory-text";

interface TabProps {
  data: MemoryData;
  profileId: string;
  name: string;
  reload: () => Promise<void>;
}

export function CoreTab({ data, profileId, name }: TabProps) {
  const [coreDraft, setCoreDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const lines: MemoryV2Line[] = [...data.core.owner, ...data.core.profile];

  return (
    <>
      <p className="text-muted-foreground text-xs">{t.coreIntro}</p>
      <div className="flex flex-col gap-1.5">
        {lines.length === 0 && <EmptyState>{t.coreEmpty(name)}</EmptyState>}
        {lines.map((line) => (
          <CoreLineRow key={line.id} line={line} profileId={profileId} />
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
            })
            .finally(() => setBusy(false));
        }}
      >
        <Input
          className="flex-1"
          aria-label={t.coreAddLabel}
          placeholder={t.coreAddPlaceholder}
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
    </>
  );
}

function CoreLineRow({ line, profileId }: { line: MemoryV2Line; profileId: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-sm">
      <div className="min-w-0 flex-1">
        <p className="break-words">{line.text}</p>
        {line.pinned && (
          <span className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
            <PinIcon className="size-3" /> {t.pinnedLabel}
          </span>
        )}
      </div>
      <ConfirmDialog
        title={t.coreRemoveTitle}
        warning={t.coreRemoveWarning}
        onConfirm={async () => {
          await api.memoryCoreRemove(line.id, profileId);
        }}
      >
        <Button variant="ghost" size="icon" aria-label={t.coreRemoveAria(line.text)}>
          <Trash2Icon />
        </Button>
      </ConfirmDialog>
    </div>
  );
}
