/**
 * Room routes: the bot-to-bot surface. Rooms are REST-only (never sessions,
 * never chord objects): list them, read one with each participant's OWN
 * transcript seat, and say something into a seat (supervision).
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Effect } from "effect";
import { projectTranscript, type MindService } from "@ultiv/mind";
import type { RoomInfo, RoomSeat, TranscriptEntry } from "@ultiv/contracts";
import { errorOf, queryOr, type RouteArgs } from "./types.ts";

export interface RoomDetail {
  readonly room: RoomInfo;
  readonly seats: (RoomSeat & { readonly name: string; readonly transcript: TranscriptEntry[] })[];
}

/** Project one seat's conversation into UI transcript entries. */
async function seatTranscript(
  mind: MindService,
  conversationId: string,
): Promise<TranscriptEntry[]> {
  try {
    const conversation = await Effect.runPromise(mind.converse.open(conversationId));
    if (conversation === undefined) return [];
    const view = await conversation.viewState(BACKGROUND_CONTEXT);
    if (view.value === undefined) return [];
    return projectTranscript(view.value.entries, undefined, false);
  } catch {
    return [];
  }
}

async function roomDetail(args: RouteArgs, room: RoomInfo): Promise<RoomDetail> {
  const seats = await args.mind.rooms.seats(args.owner, room);
  const named = await Promise.all(
    seats.map(async (seat) => {
      const profile =
        seat.conversationId !== null
          ? args.mind.profiles.profileOf(seat.conversationId)
          : undefined;
      const name =
        profile?.name ??
        args.mind.profiles.scopeOf(seat.conversationId ?? "")?.profileId ??
        seat.profileId;
      return {
        ...seat,
        name,
        transcript:
          seat.conversationId !== null ? await seatTranscript(args.mind, seat.conversationId) : [],
      };
    }),
  );
  return { room, seats: named };
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
