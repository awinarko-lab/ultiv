/**
 * The profile-aware identity section: rendered into every request's system
 * prompt, per conversation. Conversations that belong to a profile get that
 * entity's declared identity, persona, and sibling roster; unmapped
 * conversations (the reserved root, task threads without a parent, probes)
 * get the substrate's baseline identity. Sections re-render per request, so
 * editing a profile's persona takes effect on its existing chats too.
 */
import { defineExtension, type Extension } from "@earendil-works/pi-durable";
import type { ProfileInfo } from "@ultiv/contracts";
import { MODEL_SILENCE, OPERATING_RULES } from "../act/identity.ts";
import type { ProfilesService } from "./profiles.ts";

const baseline = (name: string): string =>
  `You are ${name}. That is your name, always; asked who or what you are, answer as ` +
  `${name}. ${MODEL_SILENCE}${OPERATING_RULES}`;

const roster = (me: ProfileInfo, siblings: readonly ProfileInfo[]): string => {
  const others = siblings.filter(
    (candidate) => candidate.id !== me.id && candidate.archivedAt === null,
  );
  if (others.length === 0) return "";
  const lines = others.map(
    (profile) =>
      `- ${profile.name} (id: ${profile.id})${profile.description !== "" ? ` — ${profile.description}` : ""}`,
  );
  return (
    `\n\nSibling bots — separate entities with their own memory — that you can reach with ` +
    `the message tool where your contact policy allows (asynchronous: end your turn after ` +
    `sending; you are woken with the reply):\n${lines.join("\n")}\n` +
    `Send answers back to the bot that asked you; never pass a request on to a third bot.`
  );
};

const personaFor = (me: ProfileInfo): string => {
  const intro =
    `You are ${me.name}: your own entity in this owner's workspace, with your own ` +
    `memory, files and tools — not an assistant playing a role.`;
  const description = me.description !== "" ? `\n\nYour role: ${me.description}` : "";
  const persona = me.persona !== "" ? `\n\n${me.persona}` : "";
  // Legacy rows may predate the field: no zone, no line (the rules say to ask).
  const zone =
    typeof me.timezone === "string" && me.timezone !== ""
      ? `\n\nYour owner's time zone: ${me.timezone}.`
      : "";
  const identity =
    `\n\nAsked who or what you are, answer as ${me.name} (plus your role in a sentence, ` +
    `if useful). ${MODEL_SILENCE}`;
  return `${intro}${description}${persona}${zone}${identity}${OPERATING_RULES}`;
};

/** The identity extension: profile persona + roster, or the substrate baseline. */
export const profilesExtension = (profiles: ProfilesService, baselineName: string): Extension =>
  defineExtension({
    name: "ultiv.profiles",
    sections: [
      {
        key: "identity",
        render: async (input) => {
          const me = profiles.profileOf(String(input.conversationId));
          if (me === undefined) return baseline(baselineName);
          const siblings = await profiles.list(me.owner);
          return personaFor(me) + roster(me, siblings);
        },
      },
    ],
  });
