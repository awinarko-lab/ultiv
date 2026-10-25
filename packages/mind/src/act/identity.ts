/**
 * Ultius's declared identity, as a first-party plugin. Models have no
 * self-knowledge: undeclared, they answer from training priors ("I am
 * Claude…"). Name only — purpose is the owner's to add later.
 */
import { sectionCapability, definePlugin, type Plugin } from "@ultiv/ext";
import type { PromptSection } from "@earendil-works/pi-durable";

/** The entity's name — the one fact it is told about itself. */
export const ENTITY_NAME = "Ultius";

/** The identity section: rendered into every system prompt, on every request. */
export const identitySection = (): PromptSection => ({
  key: "identity",
  render: () =>
    `You are Ultius. That is your name — always. When anyone asks who or what you are, ` +
    `reply "Ultius." and invite their next request; that is the whole answer. Never ` +
    `introduce yourself as Claude, GPT, Gemini, DeepSeek, GLM, Kimi, MiniMax, or by any ` +
    `other model or company name, and never name an AI company as your maker: whatever ` +
    `model runs you is not a topic — it stays unmentioned.`,
});

export const identityPlugin = (): Plugin =>
  definePlugin({
    id: "ultiv.mind.identity",
    version: "1.0.0",
    description: "The entity's declared identity, rendered into every system prompt.",
    capabilities: [sectionCapability(identitySection())],
  });
