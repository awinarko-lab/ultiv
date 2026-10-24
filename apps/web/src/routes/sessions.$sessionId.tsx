import { Link, useNavigate, createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { SessionView } from "@/components/session-view";
import { useSession } from "@/lib/use-session";

export const Route = createFileRoute("/sessions/$sessionId")({
  component: SessionPage,
});

function SessionPage() {
  const { sessionId } = Route.useParams();
  const session = useSession(sessionId);

  return (
    <main className="mx-auto flex h-dvh max-w-2xl flex-col gap-4 p-8">
      <header className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Session</h1>
        <Badge variant="outline">{sessionId}</Badge>
      </header>
      <SessionView
        link={session.link}
        transcript={session.transcript}
        phase={session.phase}
        lastError={session.lastError}
        pending={session.pending}
        onInput={session.input}
        onDecide={session.decide}
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
