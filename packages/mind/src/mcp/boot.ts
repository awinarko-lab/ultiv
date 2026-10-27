/**
 * Connector start-up inside the mind: the manager (saved servers reconnect
 * now, in the background), the registry wiring, and the names MCP tools must
 * never shadow (every tool installed before connectors).
 */
import type { Registry } from "@earendil-works/pi-durable";
import {
  makeMcpConfigStore,
  makeMcpManager,
  mcpDir,
  type ConnectionTuning,
  type McpManager,
  type VaultStore,
} from "@ultiv/ext";
import type { ApprovalsService } from "../approvals.ts";
import type { AuditService } from "../audit/audit.ts";
import type { ProfilesService } from "../profiles/profiles.ts";
import { makeUntrustedNotes } from "./access.ts";
import { CONNECTOR_LOAD, CONNECTOR_RESOURCES } from "./connector-tools.ts";
import { wireMcp, type McpWiring } from "./install.ts";

export interface McpOptions {
  /** Server config root (default MCP_DIR or var/mcp). */
  readonly dir?: string;
  readonly tuning?: Partial<ConnectionTuning>;
  /** Per-call timeout (default 120 s). */
  readonly callTimeoutMs?: number;
  /** Connect saved servers at start (default true). */
  readonly boot?: boolean;
}

export interface McpRuntime {
  readonly manager: McpManager;
  readonly wiring: McpWiring;
  readonly close: () => Promise<void>;
}

export const startMcp = (
  registry: Registry,
  services: {
    readonly approvals: ApprovalsService;
    readonly audit: AuditService;
    readonly profiles: ProfilesService;
  },
  vault: { readonly store: VaultStore | null; readonly root: string | null },
  options: McpOptions = {},
): McpRuntime => {
  const reserved = new Set(
    registry
      .snapshot()
      .tools()
      .map(({ tool }) => tool.name),
  );
  reserved.add(CONNECTOR_LOAD);
  reserved.add(CONNECTOR_RESOURCES);
  const manager = makeMcpManager({
    config: makeMcpConfigStore(options.dir ?? mcpDir()),
    vault: vault.store,
    vaultRoot: vault.root,
    reservedNames: () => reserved,
    ...(options.tuning !== undefined ? { tuning: options.tuning } : {}),
  });
  const wiring = wireMcp(registry, {
    manager,
    ...services,
    notes: makeUntrustedNotes(),
    callTimeoutMs: options.callTimeoutMs ?? 120_000,
  });
  if (options.boot !== false) manager.boot();
  return {
    manager,
    wiring,
    close: async () => {
      wiring.close();
      await manager.close();
    },
  };
};
