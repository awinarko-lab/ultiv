import { MessagesSquareIcon, Trash2Icon } from "lucide-react";
import { Fragment } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { ListRow } from "@/components/ui/list-row";
import { Separator } from "@/components/ui/separator";
import type { useSessions } from "@/lib/use-sessions";
import { formatWhen } from "@/lib/format";

/**
 * The extra-session history rows + New session. Main chats never appear here
 * (each bot's main chat IS the home screen). Picking a row, or creating a new
 * session, opens it at /c/$sessionId.
 */
export function HistoryList({
  sessions,
  onSelect,
}: {
  sessions: ReturnType<typeof useSessions>;
  onSelect: (sessionId: string) => void;
}) {
  const ordered = sessions.sessions
    .filter((session) => session.kind !== "main")
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt);

  const create = async (): Promise<void> => {
    const created = await sessions.create(null);
    if (created !== undefined) onSelect(created.id);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Disabled buttons swallow hover, so the reason sits on a wrapper. */}
      <span
        className="flex flex-col"
        title={
          sessions.profiles.length === 0
            ? "Spawn a bot first — sessions attach to a bot"
            : sessions.phase !== "live"
              ? "Waiting for the server"
              : undefined
        }
      >
        <Button
          variant="outline"
          size="sm"
          disabled={sessions.phase !== "live" || sessions.profiles.length === 0}
          onClick={() => void create()}
        >
          New session
        </Button>
      </span>
      <div className="flex flex-col gap-1">
        {ordered.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No extra sessions yet — each bot's main chat lives on the home screen.
          </p>
        )}
        {ordered.map((session, index) => (
          <Fragment key={session.id}>
            {index > 0 && <Separator className="my-1" />}
            <div className="flex items-center gap-1">
              <ListRow
                className="min-w-0 flex-1"
                title={session.title === "" ? "Untitled session" : session.title}
                meta={<time>{formatWhen(session.lastMessageAt)}</time>}
                onClick={() => onSelect(session.id)}
              />
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
                  className="shrink-0"
                  aria-label={`Delete ${session.title === "" ? "session" : session.title}`}
                >
                  <Trash2Icon />
                </Button>
              </ConfirmDialog>
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
