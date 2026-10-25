/**
 * The Act faculty: the mind's executable tool surface, assembled from the
 * extension registry. Gated tools pass through the approval broker at the
 * act — reads stay clean (gates acts, never asks).
 */
import { defineExtension, type Extension } from "@earendil-works/pi-durable";
import type { RegistryService, Tool } from "@ultiv/ext";
import { withApproval, type ApprovalsService } from "../approvals.ts";

export interface ActService {
  readonly tools: () => readonly Tool[];
  /** The extension installed into the harness registry for every conversation. */
  readonly extension: () => Extension;
}

export const actService = (registry: RegistryService, approvals: ApprovalsService): ActService => {
  const gate = (tool: Tool): Tool => (tool.gated === true ? withApproval(approvals, tool) : tool);
  const extension = defineExtension({
    name: "mind.act",
    tools: registry.tools().map(gate),
  });
  return {
    tools: () => registry.tools().map(gate),
    extension: () => extension,
  };
};
