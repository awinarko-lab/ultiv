/**
 * Core tab: the few lines that sit in every prompt. Shared (workspace) lines
 * and this bot's own lines are separate stores — writes go to the store the
 * line lives in. Server word budgets (120 shared / 80 per bot, 25 per line)
 * are mirrored as meters so the owner sees the limit before the 400.
 */
import { PinIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/section-header";
import { Select } from "@/components/ui/select";
import type { MemoryData } from "@/components/memory/memory-panel";
import { api, type MemoryV2Line } from "@/lib/api";
import { cn } from "@/lib/utils";
import * as t from "@/lib/memory-text";

interface TabProps {
  data: MemoryData;
  profileId: string;
  name: string;
  reload: () => Promise<void>;
}

/** "owner" store needs the owner profile param; a bot's store needs its id. */
const storeParam = (shared: boolean, profileId: string): string => (shared ? "owner" : profileId);

const wordsOf = (lines: MemoryV2Line[]): number =>
  lines.reduce((sum, line) => sum + t.countWords(line.text), 0);

export function CoreTab({ data, profileId, name, reload }: TabProps) {
  const empty = data.core.owner.length === 0 && data.core.profile.length === 0;
  return (
    <>
      <p className="text-muted-foreground text-xs">{t.coreIntro}</p>
      {empty && <EmptyState>{t.coreEmpty(name)}</EmptyState>}
      {data.core.owner.length > 0 && (
        <CoreSection
          title={t.coreSharedTitle}
          note={t.coreSharedNote}
          lines={data.core.owner}
          shared
          profileId={profileId}
          reload={reload}
        />
      )}
      {data.core.profile.length > 0 && (
        <CoreSection
          title={t.coreBotTitle}
          lines={data.core.profile}
          profileId={profileId}
          reload={reload}
        />
      )}
      <AddCoreForm data={data} profileId={profileId} reload={reload} />
    </>
  );
}

function CoreSection({
  title,
  note,
  lines,
  shared,
  profileId,
  reload,
}: {
  title: string;
  note?: string;
  lines: MemoryV2Line[];
  shared?: boolean;
  profileId: string;
  reload: () => Promise<void>;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <SectionHeader
        title={title}
        action={
          shared === true ? (
            <Badge variant="outline" className="w-fit">
              shared
            </Badge>
          ) : undefined
        }
      />
      {note !== undefined && <p className="text-muted-foreground text-xs">{note}</p>}
      {lines.map((line) => (
        <CoreLineRow
          key={line.id}
          line={line}
          shared={shared === true}
          profileId={profileId}
          reload={reload}
        />
      ))}
    </section>
  );
}

function CoreLineRow({
  line,
  shared,
  profileId,
  reload,
}: {
  line: MemoryV2Line;
  shared: boolean;
  profileId: string;
  reload: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-sm">
      <div className="min-w-0 flex-1">
        <p className="break-words">{line.text}</p>
        {line.pinned && (
          <span className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
            <PinIcon className="size-3" /> {t.pinnedLabel}
          </span>
        )}
        {error !== null && <ErrorState message={error} className="mt-1" />}
      </div>
      <ConfirmDialog
        title={t.coreRemoveTitle}
        warning={t.coreRemoveWarning}
        onConfirm={async () => {
          await api.memoryCoreRemove(line.id, storeParam(shared, profileId));
          await reload();
        }}
      >
        <Button variant="ghost" size="icon" aria-label={t.coreRemoveAria(line.text)}>
          <Trash2Icon />
        </Button>
      </ConfirmDialog>
    </div>
  );
}

function AddCoreForm({
  data,
  profileId,
  reload,
}: {
  data: MemoryData;
  profileId: string;
  reload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const budget = shared ? t.SHARED_CORE_BUDGET : t.BOT_CORE_BUDGET;
  const store = shared ? data.core.owner : data.core.profile;
  const used = wordsOf(store) + t.countWords(draft);
  const draftWords = t.countWords(draft);
  const tooLong = draftWords > t.CORE_LINE_LIMIT;
  const hint = tooLong ? t.draftTooLong : used > budget ? t.overBudget(budget) : null;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.memoryCoreAdd(draft.trim(), storeParam(shared, profileId));
      setDraft("");
      await reload();
    } catch (cause) {
      // The draft stays so a rejected line (25-word limit, budget) is fixable.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mt-2 flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim() === "" || tooLong || used > budget) return;
        void submit();
      }}
    >
      <div className="flex gap-2">
        <Input
          className="flex-1"
          aria-label={t.coreAddLabel}
          placeholder={t.coreAddPlaceholder}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={busy || draft.trim() === "" || tooLong || used > budget}
        >
          {busy ? "Adding…" : "Add"}
        </Button>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <label className="text-muted-foreground flex items-center gap-1.5">
          {t.coreTargetLabel}
          <Select
            aria-label={t.coreTargetLabel}
            className="w-44"
            value={shared ? "shared" : "bot"}
            onChange={(event) => setShared(event.target.value === "shared")}
          >
            <option value="bot">{t.coreTargetBot}</option>
            <option value="shared">{t.coreTargetShared}</option>
          </Select>
        </label>
        <span
          className={cn(
            "ml-auto",
            used > budget || tooLong ? "text-destructive" : "text-muted-foreground",
          )}
          aria-live="polite"
        >
          {t.words(used, budget)}
          {draftWords > 0 && ` · line ${t.lineWords(draftWords)}`}
        </span>
      </div>
      {hint !== null && (
        <p role="alert" className="text-destructive text-xs">
          {hint}
        </p>
      )}
      {error !== null && <ErrorState message={error} />}
    </form>
  );
}
