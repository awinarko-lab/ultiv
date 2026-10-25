/**
 * Room routes: the bot-to-bot surface. Rooms are REST-only (never sessions,
 * never chord objects). The detail view is ONE merged chat timeline with
 * speaker names — each participant's private seat conversation stays an
 * implementation detail of identity scoping, not something the owner reads.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Effect } from "effect";
import { projectTranscript, type MindService } from "@ultiv/mind";
import type { RoomInfo, RoomSeat, TranscriptEntry } from "@ultiv/contracts";
import { errorOf, queryOr, type RouteArgs } from "./types.ts";

/** One merged, speaker-labelled line of the room chat. */
export interface RoomLine {
  readonly at: number;
  readonly speaker: string;
  readonly text: string;
  readonly system: boolean;
}

export interface RoomDetail {
  readonly room: RoomInfo;
  readonly participants: { readonly profileId: string; readonly name: string }[];
  readonly timeline: RoomLine[];
}

/** Pull "[header]\n\nbody" apart and say who spoke. */
function labelInput(text: string): { speaker: string; body: string; system: boolean } | undefined {
  const headerEnd = text.indexOf("]");
  if (!text.startsWith("[") || headerEnd < 0) return undefined;
  const header = text.slice(1, headerEnd);
  const body = text.slice(headerEnd + 1).trim();
  const message = /^message from (.+?)(?: •.*)?$/.exec(header);
  if (message !== null) return { speaker: message[1] ?? "", body, system: false };
  // Reply digests duplicate the speaker's own output line — skip the copy.
  if (header.startsWith("reply from ")) return undefined;
  const nack = /^nack from (.+?)(?: •.*)?$/.exec(header);
  if (nack !== null) {
    return { speaker: "system", body: `${nack[1]}: ${body}`, system: true };
  }
  if (header === "owner") return { speaker: "owner", body, system: false };
  if (header.startsWith("cron ")) return { speaker: "cron", body, system: true };
  return undefined;
}

async function seatLines(
  mind: MindService,
  seat: RoomSeat & { name: string },
): Promise<RoomLine[]> {
  if (seat.conversationId === null) return [];
  try {
    const conversation = await Effect.runPromise(mind.converse.open(seat.conversationId));
    if (conversation === undefined) return [];
    const view = await conversation.viewState(BACKGROUND_CONTEXT);
    if (view.value === undefined) return [];
    const entries: TranscriptEntry[] = projectTranscript(view.value.entries, undefined, false);
    const lines: RoomLine[] = [];
    for (const entry of entries) {
      if (entry.kind === "input") {
        const labelled = labelInput(entry.text);
        if (labelled !== undefined && labelled.body !== "") {
          lines.push({
            at: entry.at,
            speaker: labelled.speaker,
            text: labelled.body,
            system: labelled.system,
          });
        }
      } else if (entry.kind === "output" && entry.text.trim() !== "") {
        lines.push({ at: entry.at, speaker: seat.name, text: entry.text, system: false });
      }
    }
    return lines;
  } catch {
    return [];
  }
}

async function roomDetail(args: RouteArgs, room: RoomInfo): Promise<RoomDetail> {
  const seats = await args.mind.rooms.seats(args.owner, room);
  const named = seats.map((seat) => {
    const profile =
      seat.conversationId !== null ? args.mind.profiles.profileOf(seat.conversationId) : undefined;
    return { ...seat, name: profile?.name ?? seat.profileId };
  });
  const timeline = (await Promise.all(named.map((seat) => seatLines(args.mind, seat))))
    .flat()
    .sort((a, b) => a.at - b.at);
  return {
    room,
    participants: named.map(({ profileId, name }) => ({ profileId, name })),
    timeline,
  };
}

export async function roomRoutes(args: RouteArgs): Promise<boolean> {
  const { req, mind, path, json } = args;
  const method = req.method ?? "GET";
  if (path === "/api/rooms" && method === "GET") {
    const bot = queryOr(args, "bot");
    json(200, await mind.rooms.list(args.owner, bot));
    return true;
  }
  if (path === "/api/main" && method === "GET") {
    const main = await mind.profiles.mainOf(args.owner);
    json(200, { profileId: main });
    return true;
  }
  const match = path.match(/^\/api\/rooms\/([^/]+)(\/say)?$/);
  if (match === null) return false;
  const room = await mind.rooms.get(args.owner, match[1] ?? "");
  if (room === undefined) {
    json(404, { error: "unknown room" });
    return true;
  }
  if (match[2] === undefined && method === "GET") {
    json(200, await roomDetail(args, room));
    return true;
  }
  if (match[2] === "/say" && method === "POST") {
    const body = await args.readJson<{ to?: string; text?: string }>(req);
    if (body.to === undefined || body.text === undefined || body.text.trim() === "") {
      json(400, { error: "to and text are required" });
      return true;
    }
    if (!room.participants.includes(body.to)) {
      json(400, { error: "that bot is not in this room" });
      return true;
    }
    try {
      const said = await mind.rooms.say(args.owner, room, body.to, `[owner] ${body.text}`);
      json(200, { ok: said });
    } catch (cause) {
      json(500, { error: errorOf(cause) });
    }
    return true;
  }
  return false;
}
