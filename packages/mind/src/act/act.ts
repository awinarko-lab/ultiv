/**
 * The Act faculty: the mind's executable tool surface, assembled from the
 * extension registry — tools (gated ones through the approval broker at the
 * act; gates ACTS, never ASKS) and prompt sections contributed by plugins
 * (identity and anything the app adds).
 */
import { defineExtension, type Extension } from "@earendil-works/pi-durable";
import type { RegistryService, Tool } from "@ultiv/ext";
import { withApproval, type ApprovalsService } from "../approvals.ts";
import { withAudit, type AuditService } from "../audit/audit.ts";

export interface ActService {
  readonly tools: () => readonly Tool[];
  /** The extension installed into the harness registry for every conversation. */
  readonly extension: () => Extension;
}

export const actService = (
  registry: RegistryService,
  approvals: ApprovalsService,
  audit: AuditService,
): ActService => {
  const gate = (tool: Tool): Tool => (tool.gated === true ? withApproval(approvals, tool) : tool);
  const tools: readonly Tool[] = registry
    .tools()
    .map(gate)
    .map((tool) => withAudit(audit, tool));
  const extension = defineExtension({
    name: "ultius.act",
    tools,
    sections: registry.sections(),
  });
  return {
    tools: () => tools,
    extension: () => extension,
  };
};
