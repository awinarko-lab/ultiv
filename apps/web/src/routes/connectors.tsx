import { createFileRoute } from "@tanstack/react-router";
import { ConnectorsPanel } from "@/components/connectors/connectors-panel";
import { Page } from "@/components/page";
import { useApp } from "@/lib/app-state";

export const Route = createFileRoute("/connectors")({
  component: ConnectorsPage,
});

function ConnectorsPage() {
  const { sessions } = useApp();
  return (
    <Page title="Connectors" lead="Tools from other apps and services, shared with your bots.">
      <ConnectorsPanel profiles={sessions.profiles} />
    </Page>
  );
}
