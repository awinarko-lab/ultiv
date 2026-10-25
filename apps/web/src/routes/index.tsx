import { Link, useNavigate, createFileRoute } from "@tanstack/react-router";
import { Ping } from "@ultiv/contracts";
import { Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useSessions } from "@/lib/use-sessions";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const sessions = useSessions();
  const navigate = useNavigate();

  const create = async () => {
    const created = await sessions.create(null);
    if (created !== undefined) {
      await navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: created.id },
      });
    }
  };

  const ordered = [...sessions.sessions].sort((a, b) => b.lastMessageAt - a.lastMessageAt);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 p-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">ultiv</h1>
          <Badge variant="secondary">contract v{Ping.def.version}</Badge>
        </div>
        <Button onClick={create} disabled={sessions.phase !== "live"}>
          New session
        </Button>
      </header>
      <p className="max-w-prose text-muted-foreground">
        Sessions are durable and replayable: history survives restarts, each one is its own
        conversation.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <Badge variant={sessions.phase === "live" ? "secondary" : "outline"}>
            {sessions.phase}
          </Badge>
        </CardHeader>
        {ordered.length > 0 && (
          <CardContent className="flex flex-col gap-1">
            {ordered.map((session, index) => (
              <div key={session.id} className="flex items-center gap-1">
                {index > 0 && <Separator className="my-1" />}
                <Button
                  variant="ghost"
                  className="min-w-0 flex-1 justify-between"
                  nativeButton={false}
                  render={<Link to="/sessions/$sessionId" params={{ sessionId: session.id }} />}
                >
                  <span className="truncate">
                    {session.title === "" ? "Untitled session" : session.title}
                  </span>
                  <time className="text-muted-foreground">
                    {new Date(session.lastMessageAt).toLocaleString()}
                  </time>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${session.title === "" ? "session" : session.title}`}
                  onClick={async () => {
                    await sessions.remove(session.id);
                  }}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </CardContent>
        )}
      </Card>
    </main>
  );
}
