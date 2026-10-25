/**
 * The rooms popup: bot-to-bot conversations live here — contextual threads,
 * each shown as per-bot seats so it is always clear who said what. Rooms are
 * never sessions; this dialog is their only surface, plus a supervision "say"
 * into a chosen bot's seat.
 */
import { MessagesSquareIcon, SendIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ProfileInfo, RoomInfo, TranscriptEntry } from "@ultiv/contracts";
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

interface Seat {
  profileId: string;
  conversationId: string | null;
  name: string;
  transcript: TranscriptEntry[];
}

const transcriptLine = (entry: TranscriptEntry): string => {
  if (entry.kind === "input") return entry.text;
  if (entry.kind === "output") return entry.text;
  if (entry.kind === "thinking") return `(thinking) ${entry.text}`;
  return `${entry.step.name} → ${entry.step.output ?? ""}`;
};

function RoomView({ room, profiles }: { room: RoomInfo; profiles: ProfileInfo[] }) {
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [say, setSay] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setDetail(await api.room(room.id));
  }, [room.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (profileId: string): string =>
    profiles.find((profile) => profile.id === profileId)?.name ?? profileId.slice(0, 8);

  const send = async (to: string): Promise<void> => {
    if (say.trim() === "") return;
    setBusy(true);
    try {
      await api.roomSay(room.id, to, say.trim());
      setSay("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (detail === null) return <p className="text-muted-foreground text-sm">Loading room…</p>;
  const seats: Seat[] = detail.seats;

  return (
    <div className="mt-3 flex flex-col gap-4">
      {seats.map((seat, index) => (
        <div key={seat.profileId} className="flex flex-col gap-1">
          {index > 0 && <Separator />}
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{seat.name}&rsquo;s thread</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || say.trim() === ""}
              onClick={() => void send(seat.profileId)}
            >
              <SendIcon /> say into this seat
            </Button>
          </div>
          <div className="bg-background max-h-48 overflow-y-auto rounded-md border p-2 text-sm">
            {seat.transcript.length === 0 ? (
              <p className="text-muted-foreground text-xs">(empty)</p>
            ) : (
              seat.transcript
                .filter((entry) => entry.kind !== "thinking")
                .map((entry) => (
                  <p key={entry.id} className="whitespace-pre-wrap break-words">
                    {entry.kind === "input" ? "▸ " : "▪ "}
                    {transcriptLine(entry)}
                  </p>
                ))
            )}
          </div>
        </div>
      ))}
      <Input
        placeholder="Supervise: type, then pick a seat to say it into…"
        value={say}
        onChange={(event) => setSay(event.target.value)}
      />
      <p className="text-muted-foreground text-xs">
        {nameOf(room.participants[0] ?? "")} ↔ {nameOf(room.participants[1] ?? "")}
        {room.topic !== "" ? ` • ${room.topic}` : ""}
      </p>
    </div>
  );
}

export function RoomsPanel({ profiles }: { profiles: ProfileInfo[] }) {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [open, setOpen] = useState<RoomInfo | null>(null);

  useEffect(() => {
    void api
      .rooms()
      .then(setRooms)
      .catch(() => setRooms([]));
  }, []);

  const nameOf = (profileId: string): string =>
    profiles.find((profile) => profile.id === profileId)?.name ?? profileId.slice(0, 8);

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <MessagesSquareIcon /> Bot chats
          </Button>
        }
      />
      <DialogContent>
        <DialogTitle>Bot-to-bot chats</DialogTitle>
        {rooms.length === 0 ? (
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
            <RoomView room={open} profiles={profiles} />
            <DialogClose render={<Button variant="ghost" size="sm" />}>← all rooms</DialogClose>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
