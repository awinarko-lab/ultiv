/**
 * Profile edits: the same validation and limits as create, and which
 * conversation picks the edit up. Only the bot's current main chat ("Bot Mode")
 * gets the edited profile from its next turn; its other sessions, task threads
 * and reset (old) main chats keep the profile copy they were registered with
 * until the server restarts and rebuilds the index.
 */
import { Effect } from "effect";
import { InvalidInput } from "@ultiv/core";
import type { ProfileCreate, ProfileInfo, SessionInfo } from "@ultiv/contracts";
import { KENARI_MODELS } from "../providers/kenari.ts";
import type { ConverseService } from "../converse/converse.ts";
import { readSessions, validTimezone } from "./docs.ts";

/** Field limits, shared with create. */
export const PROFILE_LIMITS = { name: 80, description: 500, persona: 8_000 } as const;

/** Reject a patch with an unknown timezone or model; `model: null` clears the override. */
export const validatePatch = (patch: Partial<ProfileCreate>): void => {
  if (patch.timezone !== undefined && !validTimezone(patch.timezone)) {
    throw new InvalidInput({ reason: `unknown timezone: ${patch.timezone}` });
  }
  if (
    patch.model !== undefined &&
    patch.model !== null &&
    !KENARI_MODELS.some((m) => m.id === patch.model?.id)
  ) {
    throw new InvalidInput({ reason: `unknown model: ${patch.model?.id}` });
  }
};

/** The stored profile after a patch; an empty role or persona clears it. */
export const patchedProfile = (
  current: ProfileInfo,
  patch: Partial<ProfileCreate>,
): ProfileInfo => ({
  ...current,
  name: patch.name !== undefined ? patch.name.trim().slice(0, PROFILE_LIMITS.name) : current.name,
  description:
    patch.description !== undefined
      ? patch.description.slice(0, PROFILE_LIMITS.description)
      : current.description,
  persona:
    patch.persona !== undefined ? patch.persona.slice(0, PROFILE_LIMITS.persona) : current.persona,
  timezone: patch.timezone ?? current.timezone,
  model: patch.model !== undefined ? patch.model : current.model,
  toolAllowlist: patch.toolAllowlist !== undefined ? patch.toolAllowlist : current.toolAllowlist,
  policies: patch.policies !== undefined ? patch.policies : current.policies,
});

/** The conversation id of a profile's current main chat, if it has one yet. */
export const mainConversationOf = async (
  converse: ConverseService,
  keyOf: (row: SessionInfo) => Promise<string>,
  owner: string,
  profileId: string,
): Promise<string | undefined> => {
  const rows = await Effect.runPromise(readSessions(converse));
  const main = rows.find(
    (row) => row.owner === owner && row.profile === profileId && row.kind === "main",
  );
  if (main === undefined) return undefined;
  const cid = await Effect.runPromise(converse.conversationIdOf(await keyOf(main)));
  return cid === undefined ? undefined : String(cid);
};
