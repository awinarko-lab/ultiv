import { Link, useNavigate, createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

  const remove = async () => {
    const ok = await sessions.remove(sessionId);
    if (ok) await navigate({ to: "/" });
  };

  return (
    <main className="mx-auto flex h-dvh w-full max-w-5xl flex-col gap-4 p-8">
      <header className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Session</h1>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{sessionId}</Badge>
          <Button variant="outline" size="sm" onClick={remove}>
            Delete
          </Button>
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
