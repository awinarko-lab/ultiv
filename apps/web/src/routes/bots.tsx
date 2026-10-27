import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BotsPanel } from "@/components/bots-panel";
import { Page } from "@/components/page";
import { useApp } from "@/lib/app-state";

export const Route = createFileRoute("/bots")({
  component: BotsPage,
});

function BotsPage() {
  const { sessions, mainId, refreshAll, lastBot } = useApp();
  const navigate = useNavigate();
  return (
    <Page title="Bots">
      <BotsPanel
        profiles={sessions.profiles}
        models={sessions.models}
        activeId={lastBot ?? mainId}
        mainId={mainId}
        refresh={refreshAll}
        onOpenMain={(id) => void navigate({ to: "/", search: id === mainId ? {} : { bot: id } })}
      />
    </Page>
  );
}
