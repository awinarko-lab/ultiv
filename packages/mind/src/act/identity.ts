/**
 * Ultius's declared identity, as a first-party plugin. Models have no
 * self-knowledge: undeclared, they answer from training priors ("I am
 * Claude…"). Name only — purpose is the owner's to add later. Profiles
 * replace this static section with the dynamic one in `profiles/section.ts`;
 * the baseline text and name live on for unmapped conversations.
 */
import { sectionCapability, definePlugin, type Plugin } from "@ultiv/ext";
import type { PromptSection } from "@earendil-works/pi-durable";

/** The entity substrate's name — the default profile's identity. */
export const ENTITY_NAME = "Ultius";

/** The baseline identity text: conversations that map to no profile. */
export const baselineIdentityText = (): string =>
  `You are Ultius. That is your name — always. When anyone asks who or what you are, ` +
  `reply "Ultius." and invite their next request; that is the whole answer. Never ` +
  `introduce yourself as Claude, GPT, Gemini, DeepSeek, GLM, Kimi, MiniMax, or by any ` +
  `other model or company name, and never name an AI company as your maker: whatever ` +
  `model runs you is not a topic — it stays unmentioned.`;

/** The identity section: rendered into every system prompt, on every request. */
export const identitySection = (): PromptSection => ({
  key: "identity",
  render: () => baselineIdentityText(),
});

export const identityPlugin = (): Plugin =>
  definePlugin({
    id: "ultiv.mind.identity",
    version: "1.0.0",
    description: "The entity's declared identity, rendered into every system prompt.",
    capabilities: [sectionCapability(identitySection())],
  });
