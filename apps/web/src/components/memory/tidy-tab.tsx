/**
 * Tidy tab: the Sunday tidy's suggestions (accept / not now), run-tidy-now,
 * and the purge. Nothing changes until the owner accepts.
 */
import { SparklesIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { MemoryData } from "@/components/memory/memory-panel";
import { api } from "@/lib/api";
import * as t from "@/lib/memory-text";

interface TabProps {
  data: MemoryData;
  profileId: string;
  name: string;
  reload: () => Promise<void>;
}

export function TidyTab({ data, profileId, reload }: TabProps) {
  const open = data.proposals.filter((proposal) => proposal.status === "open");
  return (
    <>
      <p className="text-muted-foreground text-xs">{t.tidyIntro}</p>
      <div className="flex flex-col gap-2">
        {data.openCount > 0 && (
          <Badge variant="secondary" className="w-fit">
            <SparklesIcon className="size-3" /> {t.tidyOpenBadge(data.openCount)}
          </Badge>
        )}
        {open.length === 0 && <EmptyState>{t.tidyEmpty}</EmptyState>}
        {open.map((proposal) => (
          <div key={proposal.id} className="rounded-lg border px-2.5 py-2 text-sm">
            <p className="break-words">{proposal.summary}</p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void api
                    .memoryProposalDecide(proposal.id, "accept", profileId)
                    .then(() => reload());
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
                    .then(() => reload());
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
              void api.memoryTidyRun().then(() => reload());
            }}
          >
            {t.tidyRunLabel}
          </Button>
          <ConfirmDialog
            title={t.purgeTitle}
            warning={t.purgeWarning}
            confirmLabel="Purge"
            onConfirm={async () => {
              await api.memoryPurge(profileId);
              await reload();
            }}
          >
            <Button variant="ghost" size="sm" className="text-destructive">
              {t.purgeLabel}
            </Button>
          </ConfirmDialog>
        </div>
      </div>
    </>
  );
}
