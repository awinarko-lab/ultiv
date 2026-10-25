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
import type { ProfilesService } from "./profiles.ts";

const baseline = (name: string): string =>
  `You are ${name}. That is your name — always. When anyone asks who or what you are, ` +
  `reply "${name}." and invite their next request; that is the whole answer. Never ` +
  `introduce yourself as Claude, GPT, Gemini, DeepSeek, GLM, Kimi, MiniMax, or by any ` +
  `other model or company name, and never name an AI company as your maker: whatever ` +
  `model runs you is not a topic — it stays unmentioned.`;

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
    `\n\nSiblings you may message with the message tool (asynchronous — end your turn ` +
    `after sending; you are woken with any reply):\n${lines.join("\n")}\n` +
    `Reply up the chain you received a request from; never forward sideways.`
  );
};

const personaFor = (me: ProfileInfo): string => {
  const intro =
    `You are ${me.name}, one entity of this owner's workspace — not an assistant ` +
    `playing a role; ${me.name} is who you are.`;
  const description = me.description !== "" ? `\n\n${me.description}` : "";
  const persona = me.persona !== "" ? `\n\n${me.persona}` : "";
  const identity =
    `\n\nWhen anyone asks who or what you are, reply "${me.name}." and invite their next ` +
    `request; that is the whole answer. Never introduce yourself as Claude, GPT, Gemini, ` +
    `DeepSeek, GLM, Kimi, MiniMax, or by any model or company name: whatever model runs ` +
    `you is not a topic.`;
  return `${intro}${description}${persona}${identity}`;
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
