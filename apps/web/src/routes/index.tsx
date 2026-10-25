import { Link, useNavigate, createFileRoute } from "@tanstack/react-router";
import { Ping } from "@ultiv/contracts";
import { MessageCircleIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { useSessions } from "@/lib/use-sessions";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const sessions = useSessions();
  const navigate = useNavigate();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const selectedProfile = sessions.profiles.find((profile) => profile.id === sessions.selected);

  const create = async () => {
    const created = await sessions.create(null);
    if (created !== undefined) {
      await navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: created.id },
      });
    }
  };

  const createProfile = async () => {
    const name = newName.trim();
    if (name === "") return;
    setCreating(true);
    const created = await sessions.createProfile({ name });
    setCreating(false);
    if (created !== undefined) setNewName("");
  };

  const openMain = async () => {
    if (selectedProfile === undefined) return;
    try {
      const main = await api.mainChat(selectedProfile.id);
      await navigate({ to: "/sessions/$sessionId", params: { sessionId: main.id } });
    } catch {
      // The server was unreachable; the next refresh surfaces it.
    }
  };

  const ordered = [...sessions.sessions].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  const mainRows = ordered.filter((session) => session.kind === "main");
  const rest = ordered.filter((session) => session.kind !== "main");

  const row = (session: (typeof ordered)[number]) => (
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
          {session.kind !== "session" && (
            <Badge variant="outline">{session.kind === "main" ? "main" : "dm"}</Badge>
          )}
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
  );

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

      <section className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Profile</span>
        <select
          className="bg-background rounded-md border px-2 py-1 text-sm"
          value={sessions.selected ?? ""}
          onChange={(event) =>
            sessions.select(event.target.value === "" ? undefined : event.target.value)
          }
        >
          <option value="">All profiles</option>
          {sessions.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
              {profile.archivedAt !== null ? " (archived)" : ""}
            </option>
          ))}
        </select>
        {selectedProfile !== undefined && (
          <Button variant="outline" size="sm" onClick={openMain}>
            <MessageCircleIcon />
            Open {selectedProfile.name}&rsquo;s main chat
          </Button>
        )}
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <Input
          className="w-56"
          placeholder="New profile name…"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void createProfile();
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={createProfile}
          disabled={creating || newName.trim() === ""}
        >
          <PlusIcon />
          New profile
        </Button>
        <p className="w-full text-xs text-muted-foreground">
          A profile is its own entity: persistent main chat, sessions, artifacts, vault scope —
          user-defined, no templates.
        </p>
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
            {mainRows.map((session) => (
              <Fragment key={session.id}>{row(session)}</Fragment>
            ))}
            {mainRows.length > 0 && rest.length > 0 && <Separator className="my-1" />}
            {rest.map((session, index) => (
              <Fragment key={session.id}>
                {index > 0 && <Separator className="my-1" />}
                {row(session)}
              </Fragment>
            ))}
          </CardContent>
        )}
      </Card>
    </main>
  );
}
