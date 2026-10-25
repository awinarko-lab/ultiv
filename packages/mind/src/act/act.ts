/**
 * The Act faculty: the mind's executable tool surface, assembled from the
 * extension registry. Gated tools pass through the approval broker at the
 * act — reads stay clean (gates acts, never asks).
 *
 * The extension also carries the entity's identity: models have no
 * self-knowledge, and without a declared one they answer from training
 * priors ("I am Claude…"). Name only — purpose is the owner's to add.
 */
import { defineExtension, type Extension, type PromptSection } from "@earendil-works/pi-durable";
import type { RegistryService, Tool } from "@ultiv/ext";
import { withApproval, type ApprovalsService } from "../approvals.ts";

/** The entity's name — the one fact it is told about itself. */
export const ENTITY_NAME = "Ultius";

/** The identity section: rendered into every system prompt, on every request. */
export const identitySection = (): PromptSection => ({
  key: "identity",
  render: () => `You are ${ENTITY_NAME}.`,
});

export interface ActService {
  readonly tools: () => readonly Tool[];
  /** The extension installed into the harness registry for every conversation. */
  readonly extension: () => Extension;
}

export const actService = (registry: RegistryService, approvals: ApprovalsService): ActService => {
  const gate = (tool: Tool): Tool => (tool.gated === true ? withApproval(approvals, tool) : tool);
  const extension = defineExtension({
    name: "ultius.act",
    tools: registry.tools().map(gate),
    sections: [identitySection()],
  });
  return {
    tools: () => registry.tools().map(gate),
    extension: () => extension,
  };
};
