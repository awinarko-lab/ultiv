/**
 * Home = ONE chat with the active bot (the main bot by default). The profile
 * switcher sits on top; bot management, rooms, the vault and the session
 * history live behind header dialogs — the chat is the screen. Deep links to
 * /sessions/$id still work for any individual session.
 */
import { Link, useNavigate, createFileRoute } from "@tanstack/react-router";
import { Ping } from "@ultiv/contracts";
import { BotIcon, HistoryIcon, MessagesSquareIcon, Trash2Icon } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Chat } from "@/components/chat";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BotsPanel } from "@/components/bots-panel";
import { RoomsPanel } from "@/components/rooms-panel";
import { VaultPanel } from "@/components/vault-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { useSessions } from "@/lib/use-sessions";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const sessions = useSessions();
  const [mainId, setMainId] = useState<string | null>(null);
  // The chosen bot; null = follow the main bot. Switching re-resolves its main chat.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chatEpoch, setChatEpoch] = useState(0);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  const reloadMain = useCallback(async () => {
    try {
      setMainId((await api.main()).profileId);
    } catch {
      setMainId(null);
    }
  }, []);

  useEffect(() => {
    void reloadMain();
    // Run once on mount: main is a server-side default, not a live dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const profileId = activeId ?? mainId;

  useEffect(() => {
    if (profileId === null) {
      setChatId(null);
      return;
    }
    let stale = false;
    api
      .mainChat(profileId)
      .then((session) => {
        if (!stale) {
          setChatId(session.id);
          setChatError(null);
        }
      })
      .catch((cause) => {
        if (!stale) setChatError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      stale = true;
    };
  }, [profileId, chatEpoch]);

  const refreshAll = useCallback(async () => {
    await reloadMain();
    setChatEpoch((epoch) => epoch + 1);
    await sessions.select(sessions.selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.selected, reloadMain]);

  const choosable = sessions.profiles.filter((profile) => profile.archivedAt === null);

  return (
    <main className="mx-auto flex h-dvh w-full max-w-3xl flex-col gap-3 p-4 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-xl font-semibold tracking-tight">ultiv</h1>
          <Badge variant="secondary">v{Ping.def.version}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="bg-background max-w-44 rounded-md border px-2 py-1.5 text-sm"
            value={profileId ?? ""}
            onChange={(event) => setActiveId(event.target.value === "" ? null : event.target.value)}
            aria-label="Chat with bot"
          >
            {profileId === null && <option value="">Loading…</option>}
            {choosable.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
                {profile.id === mainId ? " (main)" : ""}
              </option>
            ))}
          </select>
          {sessions.profiles.length > 0 && (
            <Dialog>
              <DialogTrigger
                render={
                  <Button variant="outline" size="sm">
                    <BotIcon /> Bots
                  </Button>
                }
              />
              <DialogContent>
                <DialogTitle>Bots</DialogTitle>
                <div className="mt-3">
                  <BotsPanel
                    profiles={sessions.profiles}
                    models={sessions.models}
                    mainId={mainId}
                    refresh={refreshAll}
                    onOpenMain={(id) => setActiveId(id)}
                  />
                </div>
              </DialogContent>
            </Dialog>
          )}
          <RoomsPanel profiles={sessions.profiles} />
          <VaultPanel profiles={sessions.profiles} />
          <HistoryDialog sessions={sessions} />
        </div>
      </header>

      {sessions.profiles.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No bots yet</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              Spawn your first bot — it introduces itself in its own chat and you take it from
              there.
            </p>
            <BotsPanel
              profiles={sessions.profiles}
              models={sessions.models}
              mainId={mainId}
              refresh={refreshAll}
              onOpenMain={(id) => setActiveId(id)}
            />
          </CardContent>
        </Card>
      ) : chatId !== null ? (
        <Chat sessionId={chatId} models={sessions.models} />
      ) : (
        <Card className="flex flex-1 items-center justify-center">
          <CardContent className="text-muted-foreground text-sm">
            {chatError !== null ? `Could not open the chat: ${chatError}` : "Opening the chat…"}
          </CardContent>
        </Card>
      )}
    </main>
  );
}

/** The session history: every conversation, new ones included — behind a dialog. */
function HistoryDialog({ sessions }: { sessions: ReturnType<typeof useSessions> }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ordered = [...sessions.sessions].sort((a, b) => b.lastMessageAt - a.lastMessageAt);

  const create = async (): Promise<void> => {
    const created = await sessions.create(null);
    setOpen(false);
    if (created !== undefined) {
      await navigate({ to: "/sessions/$sessionId", params: { sessionId: created.id } });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <HistoryIcon /> History
          </Button>
        }
      />
      <DialogContent>
        <DialogTitle>Session history</DialogTitle>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={sessions.phase !== "live"}
          onClick={() => void create()}
        >
          New session
        </Button>
        <div className="mt-3 flex max-h-96 flex-col gap-1 overflow-y-auto">
          {ordered.length === 0 && (
            <p className="text-muted-foreground text-sm">No sessions yet.</p>
          )}
          {ordered.map((session, index) => (
            <Fragment key={session.id}>
              {index > 0 && <Separator className="my-1" />}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  className="min-w-0 flex-1 justify-between"
                  nativeButton={false}
                  onClick={() => setOpen(false)}
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
                  <ConfirmDialog
                    title="Delete session?"
                    warning="The conversation and its transcript are removed. This cannot be undone."
                    onConfirm={async () => {
                      await sessions.remove(session.id);
                    }}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${session.title === "" ? "session" : session.title}`}
                    >
                      <Trash2Icon />
                    </Button>
                  </ConfirmDialog>
                )}
              </div>
            </Fragment>
          ))}
        </div>
        <p className="text-muted-foreground mt-3 flex items-center gap-1 text-xs">
          <MessagesSquareIcon className="size-3.5" /> Each bot keeps one main chat — it lives on the
          home screen. Extra sessions live here.
        </p>
      </DialogContent>
    </Dialog>
  );
}
