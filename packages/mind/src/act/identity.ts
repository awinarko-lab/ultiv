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
  render: () => `You are ${ENTITY_NAME}.`,
});

export const identityPlugin = (): Plugin =>
  definePlugin({
    id: "ultiv.mind.identity",
    version: "1.0.0",
    description: "The entity's declared identity, rendered into every system prompt.",
    capabilities: [sectionCapability(identitySection())],
  });
