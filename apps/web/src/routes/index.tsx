/**
 * Home = ONE chat with the active bot (the main bot by default). The profile
 * switcher sits on top; bot management, rooms, the vault and the session
 * history live behind header dialogs on desktop — and behind a bottom tab bar
 * on phones (pattern 12: large targets, no hover-only controls). Deep links to
 * /sessions/$id still work for any individual session.
 */
import { Link, useNavigate, createFileRoute } from "@tanstack/react-router";
import { Ping } from "@ultiv/contracts";
import { BotIcon, HistoryIcon, KeyRoundIcon, MessagesSquareIcon, Trash2Icon } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Chat } from "@/components/chat";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BotsPanel } from "@/components/bots-panel";
import { OnboardingHome } from "@/components/onboarding";
import { RoomsPanel } from "@/components/rooms-panel";
import { VaultContent, VaultPanel } from "@/components/vault-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { useSessions } from "@/lib/use-sessions";

type MobileTab = "chat" | "bots" | "vault" | "history";

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
  // Phones navigate the panels through the bottom tab bar; desktop ignores it.
  const [tab, setTab] = useState<MobileTab>("chat");

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
  const botsPanel = (
    <BotsPanel
      profiles={sessions.profiles}
      models={sessions.models}
      mainId={mainId}
      refresh={refreshAll}
      onOpenMain={(id) => {
        setActiveId(id);
        setTab("chat");
      }}
    />
  );

  return (
    <div className="flex h-dvh w-full">
      {/* Desktop: the bots sidebar is persistent (pattern 2's profile sidebar). */}
      <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r p-4 lg:flex">
        <h2 className="text-muted-foreground text-xs font-semibold uppercase">Bots</h2>
        {botsPanel}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col gap-3 p-4 pb-24 sm:p-8 sm:pb-8">
        <header className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h1 className="font-heading text-xl font-semibold tracking-tight">ultiv</h1>
            <Badge variant="secondary">v{Ping.def.version}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="bg-background max-w-44 rounded-md border px-2 py-1.5 text-sm"
              value={profileId ?? ""}
              onChange={(event) =>
                setActiveId(event.target.value === "" ? null : event.target.value)
              }
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
            {/* Desktop keeps the panels in the header; phones use the bottom bar. */}
            <div className="hidden items-center gap-2 sm:flex">
              {sessions.profiles.length > 0 && (
                <Dialog>
                  <DialogTrigger
                    render={
                      <Button variant="outline" size="sm" className="lg:hidden">
                        <BotIcon /> Bots
                      </Button>
                    }
                  />
                  <DialogContent>
                    <DialogTitle>Bots</DialogTitle>
                    <div className="mt-3">{botsPanel}</div>
                  </DialogContent>
                </Dialog>
              )}
              <RoomsPanel profiles={sessions.profiles} />
              <VaultPanel profiles={sessions.profiles} />
              <HistoryDialog sessions={sessions} triggerClassName="xl:hidden" />
            </div>
          </div>
        </header>

        {/* The chat never unmounts — switching tabs only hides it (chord link stays). */}
        <div
          className={
            tab === "chat"
              ? "mx-auto flex w-full max-w-4xl min-h-0 flex-1 flex-col"
              : "mx-auto hidden w-full max-w-4xl min-h-0 flex-1 flex-col sm:flex"
          }
        >
          {sessions.profiles.length === 0 ? (
            <OnboardingHome
              models={sessions.models}
              custom={botsPanel}
              onCreated={async (id) => {
                await refreshAll();
                setActiveId(id);
              }}
            />
          ) : chatId !== null ? (
            <Chat sessionId={chatId} models={sessions.models} />
          ) : (
            <Card className="flex flex-1 items-center justify-center">
              <CardContent className="text-muted-foreground text-sm">
                {chatError !== null ? `Could not open the chat: ${chatError}` : "Opening the chat…"}
              </CardContent>
            </Card>
          )}
        </div>

        {tab === "bots" && sessions.profiles.length > 0 && (
          <div className="min-h-0 flex-1 overflow-y-auto sm:hidden">{botsPanel}</div>
        )}
        {tab === "vault" && (
          <div className="min-h-0 flex-1 overflow-y-auto sm:hidden">
            <VaultContent profiles={sessions.profiles} />
          </div>
        )}
        {tab === "history" && (
          <div className="min-h-0 flex-1 overflow-y-auto sm:hidden">
            <HistoryList sessions={sessions} onNavigate={() => setTab("chat")} />
          </div>
        )}

        <nav
          aria-label="Sections"
          className="bg-card fixed inset-x-0 bottom-0 z-40 flex border-t sm:hidden"
        >
          <TabButton
            icon={MessagesSquareIcon}
            label="Chat"
            active={tab === "chat"}
            onClick={() => setTab("chat")}
          />
          <TabButton
            icon={BotIcon}
            label="Bots"
            active={tab === "bots"}
            onClick={() => setTab("bots")}
          />
          <TabButton
            icon={KeyRoundIcon}
            label="Vault"
            active={tab === "vault"}
            onClick={() => setTab("vault")}
          />
          <TabButton
            icon={HistoryIcon}
            label="History"
            active={tab === "history"}
            onClick={() => setTab("history")}
          />
        </nav>
      </main>
      {/* Wide desktop: history as a persistent rail instead of a dialog. */}
      <aside className="hidden w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l p-4 xl:flex">
        <h2 className="text-muted-foreground text-xs font-semibold uppercase">History</h2>
        <HistoryList sessions={sessions} onNavigate={() => setTab("chat")} />
      </aside>
    </div>
  );
}

/** One bottom-bar tab: a ~48px tap target with icon + label. */
function TabButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof BotIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex flex-1 cursor-pointer flex-col items-center gap-0.5 py-2.5 text-[11px] ${
        active ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      <Icon className="size-5" />
      {label}
    </button>
  );
}

/** The session history rows + New session — shared by the dialog and the mobile tab. */
function HistoryList({
  sessions,
  onNavigate,
}: {
  sessions: ReturnType<typeof useSessions>;
  onNavigate: () => void;
}) {
  const navigate = useNavigate();
  const ordered = [...sessions.sessions].sort((a, b) => b.lastMessageAt - a.lastMessageAt);

  const create = async (): Promise<void> => {
    const created = await sessions.create(null);
    onNavigate();
    if (created !== undefined) {
      await navigate({ to: "/sessions/$sessionId", params: { sessionId: created.id } });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="outline"
        size="sm"
        disabled={sessions.phase !== "live"}
        onClick={() => void create()}
      >
        New session
      </Button>
      <div className="flex flex-col gap-1">
        {ordered.length === 0 && <p className="text-muted-foreground text-sm">No sessions yet.</p>}
        {ordered.map((session, index) => (
          <Fragment key={session.id}>
            {index > 0 && <Separator className="my-1" />}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                className="min-w-0 flex-1 justify-between"
                nativeButton={false}
                onClick={onNavigate}
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
      <p className="text-muted-foreground flex items-center gap-1 text-xs">
        <MessagesSquareIcon className="size-3.5" /> Each bot keeps one main chat — it lives on the
        home screen. Extra sessions live here.
      </p>
    </div>
  );
}

/** The desktop header entry: history behind a dialog. */
function HistoryDialog({
  sessions,
  triggerClassName,
}: {
  sessions: ReturnType<typeof useSessions>;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className={triggerClassName}>
            <HistoryIcon /> History
          </Button>
        }
      />
      <DialogContent>
        <DialogTitle>Session history</DialogTitle>
        <div className="mt-3 max-h-96 overflow-y-auto">
          <HistoryList sessions={sessions} onNavigate={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
