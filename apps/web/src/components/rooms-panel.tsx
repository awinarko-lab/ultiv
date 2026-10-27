/**
 * Bot talks (rooms): bot-to-bot conversations as ONE chat with participant
 * names — the same shape as the owner's own threads. Per-seat internals are
 * invisible here; a supervision "say" posts into a chosen bot's side.
 */
import { ArrowLeftIcon, MessagesSquareIcon, SendIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useState } from "react";
import type { ProfileInfo, RoomInfo } from "@ultiv/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api, type RoomDetail } from "@/lib/api";
import { notifyError } from "@/lib/notify";
import { formatWhen } from "@/lib/format";

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
      <div className="bg-background max-h-[45dvh] overflow-y-auto rounded-lg border p-3 text-sm">
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
                    <span className="text-muted-foreground ml-2 text-xs">
                      {formatWhen(line.at)}
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
        <Select className="w-36" value={to} onChange={(event) => setTo(event.target.value)}>
          {detail.participants.map((participant) => (
            <option key={participant.profileId} value={participant.profileId}>
              to {participant.name}
            </option>
          ))}
        </Select>
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

export function RoomsContent({
  profiles,
  botId,
  roomId,
  onOpen,
}: {
  profiles: ProfileInfo[];
  /** Only this bot's rooms. */
  botId?: string | undefined;
  /** The open room (from the URL), undefined = the list. */
  roomId?: string | undefined;
  onOpen: (roomId: string | null) => void;
}) {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setRooms(await api.rooms(botId));
      setLoadFailed(false);
    } catch {
      // A failed load is not an empty list: say so and offer a retry.
      setLoadFailed(true);
    } finally {
      setLoaded(true);
    }
  }, [botId]);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (profileId: string): string =>
    profiles.find((profile) => profile.id === profileId)?.name ?? profileId.slice(0, 8);
  const open = rooms.find((room) => room.id === roomId);

  if (loadFailed && rooms.length === 0) {
    return <ErrorState message="Couldn't load the conversations." onRetry={() => void load()} />;
  }
  if (open !== undefined) {
    return (
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" className="self-start" onClick={() => onOpen(null)}>
          <ArrowLeftIcon /> All conversations
        </Button>
        <RoomView room={open} reload={load} />
      </div>
    );
  }
  if (!loaded) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (rooms.length === 0) {
    return (
      <EmptyState>None yet. Bots start one when they message each other, one per topic.</EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {rooms.map((room) => (
        <ListRow
          key={room.id}
          leading={<MessagesSquareIcon />}
          title={
            <>
              {room.participants.map((id) => nameOf(id)).join(" ↔ ")}
              {room.topic !== "" && (
                <Badge variant="outline" className="ml-2">
                  {room.topic}
                </Badge>
              )}
            </>
          }
          meta={formatWhen(room.lastMessageAt)}
          onClick={() => onOpen(room.id)}
        />
      ))}
    </div>
  );
}
