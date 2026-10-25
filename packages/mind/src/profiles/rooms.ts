/**
 * Rooms: contextual conversations between bots. A pair may have many rooms
 * ("Q3 report", "onboarding", …); each participant experiences the room
 * through their OWN conversation (`{owner}:room:{roomId}:{profileId}`), so
 * the identity section renders THEIR persona and memory/tools scope to THEIR
 * profile — fixing the shared-DM identity bug at the root. Rooms are not
 * sessions and never appear in session lists; the app reads them via REST.
 */
import { randomUUID } from "node:crypto";
import { defineDoc } from "@earendil-works/pi-durable";
import { Effect } from "effect";
import type { RoomInfo, RoomList } from "@ultiv/contracts";
import type { ConverseService } from "../converse/converse.ts";
import type { ProfilesService } from "./profiles.ts";

export const RoomsDoc = defineDoc<{ items: RoomInfo[] }>({
  kind: "ultiv.rooms",
  version: 1,
  scope: "session",
  initial: () => ({ items: [] }),
  checkpointWhen: () => true,
});

/** One participant's conversation key inside a room. */
export const roomConversationKey = (owner: string, roomId: string, profileId: string): string =>
  `${owner}:room:${roomId}:${profileId}`;

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

const normalizeTopic = (topic: string): string => topic.trim().slice(0, 200);

const run = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(effect) as Promise<A>;

const readRooms = (converse: ConverseService): Promise<RoomList> =>
  run(converse.docs.snapshot(RoomsDoc)).then((doc) => doc?.items ?? []);

const writeRooms = (
  converse: ConverseService,
  change: (items: RoomList) => RoomList,
): Promise<void> =>
  run(
    converse.docs.commit(async (tx) => {
      const draft = await tx.doc(RoomsDoc);
      draft.items = change(draft.items);
    }),
  );

export interface RoomsService {
  /** Find or create the room for a participant set and topic (contextual DMs). */
  readonly ensure: (
    owner: string,
    participants: readonly string[],
    topic: string,
  ) => Promise<RoomInfo>;
  readonly get: (owner: string, id: string) => Promise<RoomInfo | undefined>;
  readonly list: (owner: string, profileId?: string) => Promise<RoomList>;
  /** The durable conversation ids for each seat (null before first use). */
  readonly seats: (
    owner: string,
    room: RoomInfo,
  ) => Promise<{ readonly profileId: string; readonly conversationId: string | null }[]>;
  /** Admit a text into one participant's seat and settle it (supervision say). */
  readonly say: (
    owner: string,
    room: RoomInfo,
    profileId: string,
    text: string,
  ) => Promise<boolean>;
  readonly touch: (owner: string, roomId: string) => Promise<void>;
  /** Remove every room the profile participates in (purge cascade). */
  readonly purgeProfile: (owner: string, profileId: string) => Promise<number>;
}

export const roomsService = (deps: {
  readonly converse: ConverseService;
  readonly profiles: ProfilesService;
}): RoomsService => {
  const { converse, profiles } = deps;

  const ensureSeat = async (owner: string, room: RoomInfo, profileId: string): Promise<string> => {
    const profile = await profiles.get(owner, profileId);
    if (profile === undefined) throw new Error(`unknown profile ${profileId}`);
    const key = roomConversationKey(owner, room.id, profileId);
    await profiles.adoptConversation(key, {
      owner,
      profileId,
      kind: "room",
      participants: room.participants,
    });
    const cid = await run(converse.conversationIdOf(key));
    if (cid === undefined) throw new Error(`room seat ${key} unmapped`);
    return cid;
  };

  const service: RoomsService = {
    ensure: async (owner, participants, topic) => {
      const normalized = normalizeTopic(topic);
      const existing = await readRooms(converse);
      const found = existing.find(
        (room) =>
          room.owner === owner &&
          room.topic === normalized &&
          sameSet(room.participants, participants),
      );
      if (found !== undefined) return found;
      const room: RoomInfo = {
        id: randomUUID(),
        owner,
        topic: normalized,
        participants: [...participants],
        createdAt: Date.now(),
        lastMessageAt: Date.now(),
      };
      await writeRooms(converse, (items) => [...items, room]);
      for (const profileId of room.participants) {
        await ensureSeat(owner, room, profileId);
      }
      return room;
    },
    get: (owner, id) =>
      readRooms(converse).then((rooms) =>
        rooms.find((room) => room.owner === owner && room.id === id),
      ),
    list: (owner, profileId) =>
      readRooms(converse).then((rooms) =>
        rooms
          .filter((room) => room.owner === owner)
          .filter((room) => profileId === undefined || room.participants.includes(profileId))
          .sort((a, b) => b.lastMessageAt - a.lastMessageAt),
      ),
    seats: (owner, room) =>
      Promise.all(
        room.participants.map(async (profileId) => {
          const key = roomConversationKey(owner, room.id, profileId);
          const cid = await run(converse.conversationIdOf(key));
          return { profileId, conversationId: cid === undefined ? null : String(cid) };
        }),
      ),
    say: async (owner, room, profileId, text) => {
      const conversationId = await ensureSeat(owner, room, profileId);
      const conversation = await run(converse.open(conversationId));
      if (conversation === undefined) return false;
      const submission = await run(converse.submit(conversation, text));
      void run(converse.settle(conversation, submission)).catch((cause) => {
        console.error("room say failed:", cause);
      });
      await service.touch(owner, room.id);
      return true;
    },
    touch: (owner, roomId) =>
      writeRooms(converse, (items) =>
        items.map((room) =>
          room.owner === owner && room.id === roomId
            ? { ...room, lastMessageAt: Date.now() }
            : room,
        ),
      ),
    purgeProfile: (owner, profileId) =>
      readRooms(converse).then(async (rooms) => {
        const remaining = rooms.filter(
          (room) => room.owner === owner && !room.participants.includes(profileId),
        );
        if (remaining.length !== rooms.length) await writeRooms(converse, () => remaining);
        return rooms.length - remaining.length;
      }),
  };
  return service;
};
