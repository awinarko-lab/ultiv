/**
 * The rooms popup: bot-to-bot conversations as ONE chat with participant
 * names — the same shape as the owner's own threads. Per-seat internals are
 * invisible here; a supervision "say" posts into a chosen bot's side.
 */
import { MessagesSquareIcon, SendIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useState } from "react";
import type { ProfileInfo, RoomInfo } from "@ultiv/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { api, type RoomDetail } from "@/lib/api";
import { notifyError } from "@/lib/notify";

function RoomView({ room, reload }: { room: RoomInfo; reload: () => Promise<void> }) {
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [say, setSay] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setDetail(await api.room(room.id));
  }, [room.id]);

  useEffect(() => {
    load().catch((cause: unknown) => notifyError("Couldn't load the room", cause, "room-load"));
  }, [load]);

  useEffect(() => {
    if (detail !== null && to === "" && detail.participants.length > 0) {
      setTo(detail.participants[0]?.profileId ?? "");
    }
  }, [detail, to]);

  const send = async (): Promise<void> => {
    if (say.trim() === "" || to === "") return;
    setBusy(true);
    try {
      await api.roomSay(room.id, to, say.trim());
      setSay("");
      await load();
      await reload();
    } catch (cause) {
      notifyError("Message not sent", cause);
    } finally {
      setBusy(false);
    }
  };

  if (detail === null) return <p className="text-muted-foreground text-sm">Loading room…</p>;
  const title = detail.participants.map((participant) => participant.name).join(" ↔ ");

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="bg-background max-h-[45dvh] overflow-y-auto rounded-md border p-3 text-sm">
        {detail.timeline.length === 0 ? (
          <p className="text-muted-foreground text-xs">(no messages yet)</p>
        ) : (
          detail.timeline.map((line, index) => {
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only timeline
            const body = line.text;
            return (
              <div key={index} className="mb-2">
                {line.system ? (
                  <p className="text-muted-foreground text-xs italic">{line.text}</p>
                ) : (
                  <>
                    <span
                      className={
                        line.speaker === "owner"
                          ? "text-accent-foreground font-semibold"
                          : "font-semibold"
                      }
                    >
                      {line.speaker}
                    </span>
                    <span className="text-muted-foreground ml-2 text-[10px]">
                      {new Date(line.at).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <div className="max-h-64 overflow-y-auto break-words [&_p:first-child]:mt-1 [&_p:last-child]:mb-0">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="flex gap-2">
        <select
          className="bg-background rounded-md border px-2 py-1 text-sm"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        >
          {detail.participants.map((participant) => (
            <option key={participant.profileId} value={participant.profileId}>
              to {participant.name}
            </option>
          ))}
        </select>
        <Input
          className="flex-1"
          placeholder="Say something into this bot's side…"
          value={say}
          onChange={(event) => setSay(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void send();
          }}
        />
        <Button size="sm" disabled={busy || say.trim() === ""} onClick={() => void send()}>
          <SendIcon />
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        {title}
        {room.topic !== "" ? ` • ${room.topic}` : ""}
      </p>
    </div>
  );
}

export function RoomsPanel({
  profiles,
  botId,
  reload,
}: {
  profiles: ProfileInfo[];
  /** Scope to one bot's rooms (used from inside a session thread). */
  botId?: string;
  reload?: () => Promise<void>;
}) {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState<RoomInfo | null>(null);

  const load = useCallback(async () => {
    try {
      setRooms(await api.rooms(botId));
      setLoadFailed(false);
    } catch {
      // A failed load is not an empty list: say so and offer a retry.
      setLoadFailed(true);
    }
  }, [botId]);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (profileId: string): string =>
    profiles.find((profile) => profile.id === profileId)?.name ?? profileId.slice(0, 8);

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <MessagesSquareIcon /> Bot chats{rooms.length > 0 ? ` (${rooms.length})` : ""}
          </Button>
        }
      />
      <DialogContent>
        <DialogTitle>
          {botId === undefined ? "Bot-to-bot chats" : `Chats of ${nameOf(botId)}`}
        </DialogTitle>
        {loadFailed && rooms.length === 0 ? (
          <p className="text-destructive mt-2 flex items-center gap-2 text-sm">
            Couldn't load rooms.
            <Button variant="link" size="xs" className="h-auto p-0" onClick={() => void load()}>
              Retry
            </Button>
          </p>
        ) : rooms.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">
            No rooms yet — bots open them by messaging each other (each topic is its own thread).
          </p>
        ) : open === null ? (
          <div className="mt-3 flex flex-col gap-1">
            {rooms.map((room) => (
              <Button
                key={room.id}
                variant="ghost"
                className="justify-start"
                onClick={() => setOpen(room)}
              >
                {room.participants.map((id) => nameOf(id)).join(" ↔ ")}
                {room.topic !== "" && <Badge variant="outline">{room.topic}</Badge>}
                <span className="text-muted-foreground ml-auto text-xs">
                  {new Date(room.lastMessageAt).toLocaleString()}
                </span>
              </Button>
            ))}
          </div>
        ) : (
          <>
            <RoomView room={open} reload={reload ?? load} />
            <Separator />
            <DialogClose render={<Button variant="ghost" size="sm" />}>← all rooms</DialogClose>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
