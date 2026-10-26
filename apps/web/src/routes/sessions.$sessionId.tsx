import { Link, useNavigate, createFileRoute } from "@tanstack/react-router";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RoomsPanel } from "@/components/rooms-panel";
import { SessionView } from "@/components/session-view";
import { TasksPanel } from "@/components/tasks-panel";
import { useSessions } from "@/lib/use-sessions";
import { useSession } from "@/lib/use-session";

export const Route = createFileRoute("/sessions/$sessionId")({
  component: SessionPage,
});

function SessionPage() {
  const { sessionId } = Route.useParams();
  const session = useSession(sessionId);
  const sessions = useSessions();
  const navigate = useNavigate();

  const row = sessions.sessions.find((candidate) => candidate.id === sessionId);
  const isMain = row?.kind === "main";
  const botId = row?.profile;

  // Throws on failure — the confirm dialog stays open and shows the reason.
  const remove = async (): Promise<void> => {
    await sessions.remove(sessionId);
    await navigate({ to: "/" });
  };

  return (
    <main className="mx-auto flex h-dvh w-full max-w-5xl flex-col gap-4 p-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="font-heading text-xl font-semibold tracking-tight">
            {isMain ? "Main chat" : "Session"}
          </h1>
          <Badge variant="outline">{sessionId}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {botId !== undefined && <RoomsPanel profiles={sessions.profiles} botId={botId} />}
          {!isMain && (
            <ConfirmDialog
              title="Delete session?"
              warning="The conversation and its transcript are removed. This cannot be undone."
              onConfirm={remove}
            >
              <Button variant="outline" size="sm">
                Delete
              </Button>
            </ConfirmDialog>
          )}
        </div>
      </header>
      <TasksPanel conversationId={session.conversationId} />
      <SessionView
        link={session.link}
        transcript={session.transcript}
        phase={session.phase}
        lastError={session.lastError}
        pending={session.pending}
        usage={session.usage}
        model={session.model}
        effort={session.effort}
        models={sessions.models}
        onInput={session.input}
        onDecide={session.decide}
        onConfigure={session.configure}
        onInterrupt={session.interrupt}
      />
      <Link
        className="w-fit text-sm text-muted-foreground underline-offset-4 hover:underline"
        to="/"
      >
        ← All sessions
      </Link>
    </main>
  );
}
