import { Link, useNavigate, createFileRoute } from "@tanstack/react-router";
import { Ping } from "@ultiv/contracts";
import { Trash2Icon } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { BotsPanel } from "@/components/bots-panel";
import { RoomsPanel } from "@/components/rooms-panel";
import { VaultPanel } from "@/components/vault-panel";
import { api } from "@/lib/api";
import { useSessions } from "@/lib/use-sessions";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const sessions = useSessions();
  const navigate = useNavigate();
  const [mainId, setMainId] = useState<string | null>(null);

  const reloadMain = useCallback(async () => {
    try {
      setMainId((await api.main()).profileId);
    } catch {
      setMainId(null);
    }
  }, []);

  // The main bot is the default selection; switching stays free.
  useEffect(() => {
    void reloadMain().then(() => {
      void api
        .main()
        .then(({ profileId }) => {
          if (sessions.selected === undefined) sessions.select(profileId);
        })
        .catch(() => {});
    });
    // Run once on mount: main is a server-side default, not a live dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshAll = useCallback(async () => {
    await reloadMain();
    await sessions.select(sessions.selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.selected, reloadMain]);

  const create = async () => {
    const created = await sessions.create(null);
    if (created !== undefined) {
      await navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: created.id },
      });
    }
  };

  const openMain = useCallback(
    async (profileId: string) => {
      try {
        const main = await api.mainChat(profileId);
        await navigate({ to: "/sessions/$sessionId", params: { sessionId: main.id } });
      } catch {
        // Server unreachable; the next refresh surfaces it.
      }
    },
    [navigate],
  );

  const ordered = [...sessions.sessions].sort((a, b) => b.lastMessageAt - a.lastMessageAt);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 p-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">ultiv</h1>
          <Badge variant="secondary">contract v{Ping.def.version}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <RoomsPanel profiles={sessions.profiles} />
          <VaultPanel profiles={sessions.profiles} />
          <Button onClick={create} disabled={sessions.phase !== "live"}>
            New session
          </Button>
        </div>
      </header>

      <BotsPanel
        profiles={sessions.profiles}
        mainId={mainId}
        refresh={refreshAll}
        onOpenMain={openMain}
      />

      <section className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Chatting with</span>
        <select
          className="bg-background rounded-md border px-2 py-1 text-sm"
          value={sessions.selected ?? ""}
          onChange={(event) =>
            sessions.select(event.target.value === "" ? undefined : event.target.value)
          }
        >
          <option value="">All bots</option>
          {sessions.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
              {profile.id === mainId ? " (main)" : ""}
            </option>
          ))}
        </select>
      </section>

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
              <Fragment key={session.id}>
                {index > 0 && <Separator className="my-1" />}
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    className="min-w-0 flex-1 justify-between"
                    nativeButton={false}
                    render={<Link to="/sessions/$sessionId" params={{ sessionId: session.id }} />}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">
                        {session.title === "" ? "Untitled session" : session.title}
                      </span>
                      {session.kind === "main" && <Badge variant="outline">main chat</Badge>}
                    </span>
                    <time className="text-muted-foreground">
                      {new Date(session.lastMessageAt).toLocaleString()}
                    </time>
                  </Button>
                  {session.kind !== "main" && (
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
                  )}
                </div>
              </Fragment>
            ))}
          </CardContent>
        )}
      </Card>
    </main>
  );
}
