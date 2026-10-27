/**
 * Profile edits: the same validation and limits as create, and the refresh
 * of every conversation's profile copy. Each chat of the bot (main, reset
 * mains, sessions, task threads) gets the edited profile from its next turn.
 */
import { InvalidInput } from "@ultiv/core";
import type { ProfileCreate, ProfileInfo } from "@ultiv/contracts";
import { KENARI_MODELS } from "../providers/kenari.ts";
import { validTimezone } from "./docs.ts";

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

/** Point every conversation that carries this profile at its edited copy. */
export const refreshCopies = (copies: Map<string, ProfileInfo>, next: ProfileInfo): void => {
  for (const [conversationId, copy] of copies) {
    if (copy.owner === next.owner && copy.id === next.id) copies.set(conversationId, next);
  }
};
