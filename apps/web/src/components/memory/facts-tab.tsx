/**
 * Facts tab: everything this bot's store holds, plus the shared (workspace)
 * facts, labelled — the footer's promise is only true if they show. Per-item
 * forget routes to the store the fact lives in.
 */
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/section-header";
import type { MemoryData } from "@/components/memory/memory-panel";
import { api, type MemoryV2Fact } from "@/lib/api";
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
  const shared = data.sharedFacts.filter((fact) => fact.status !== "forgotten");

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
      {facts.length === 0 && shared.length === 0 && <EmptyState>{t.factsEmpty(name)}</EmptyState>}
      {facts.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionHeader title={t.factsBotTitle} />
          {facts.map((fact) => (
            <FactRow
              key={fact.id}
              fact={fact}
              shared={false}
              profileId={profileId}
              reload={reload}
            />
          ))}
        </section>
      )}
      {shared.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionHeader
            title={t.factsSharedTitle}
            action={
              <Badge variant="outline" className="w-fit">
                shared
              </Badge>
            }
          />
          {shared.map((fact) => (
            <FactRow key={fact.id} fact={fact} shared profileId={profileId} reload={reload} />
          ))}
        </section>
      )}
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

function FactRow({
  fact,
  shared,
  profileId,
  reload,
}: {
  fact: MemoryV2Fact;
  shared: boolean;
  profileId: string;
  reload: () => Promise<void>;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-sm">
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
        warning={t.forgetWarning(shared ? "Every bot" : "The bot")}
        confirmLabel="Forget"
        onConfirm={async () => {
          await api.memoryFactForget(fact.id, shared ? "owner" : profileId);
          await reload();
        }}
      >
        <Button variant="ghost" size="icon" aria-label={t.forgetAria(fact.text)}>
          <Trash2Icon />
        </Button>
      </ConfirmDialog>
    </div>
  );
}
