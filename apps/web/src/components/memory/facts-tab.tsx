/**
 * Facts tab: everything the bot's store holds, with per-item forget and the
 * add form. Owner-curated — human writes are always allowed (writer: null).
 */
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export function FactsTab({ data, profileId, name, reload }: TabProps) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const facts = data.facts.filter((fact) => fact.status !== "forgotten");

  const add = async (): Promise<void> => {
    if (draft.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await api.profileMemoryAdd(profileId, draft.trim());
      setDraft("");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {facts.length === 0 && <EmptyState>{t.factsEmpty(name)}</EmptyState>}
      {facts.map((fact) => (
        <div key={fact.id} className="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-sm">
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
            title={t.forgetTitle}
            warning={t.forgetWarning(name)}
            confirmLabel="Forget"
            onConfirm={async () => {
              await api.memoryFactForget(fact.id, profileId);
              await reload();
            }}
          >
            <Button variant="ghost" size="icon" aria-label={t.forgetAria(fact.text)}>
              <Trash2Icon />
            </Button>
          </ConfirmDialog>
        </div>
      ))}
      <form
        className="mt-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <Input
          className="flex-1"
          aria-label={t.addLabel(name)}
          placeholder={t.addPlaceholder(name)}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" variant="outline" size="sm" disabled={busy || draft.trim() === ""}>
          {busy ? "Saving…" : "Remember"}
        </Button>
      </form>
      {error !== null && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </>
  );
}
