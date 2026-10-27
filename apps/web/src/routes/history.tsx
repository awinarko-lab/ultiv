import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { HistoryList } from "@/components/history-list";
import { Page } from "@/components/page";
import { useApp } from "@/lib/app-state";

export const Route = createFileRoute("/history")({
  component: HistoryPage,
});

function HistoryPage() {
  const { sessions } = useApp();
  const navigate = useNavigate();
  return (
    <Page title="History">
      <HistoryList
        sessions={sessions}
        onSelect={(sessionId) => void navigate({ to: "/c/$sessionId", params: { sessionId } })}
      />
    </Page>
  );
}
