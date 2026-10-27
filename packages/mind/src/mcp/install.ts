/**
 * Connectors reach every conversation without a restart: each server is its
 * own pi-durable extension, installed (or replaced in place) when its tools
 * change and uninstalled when it is removed or switched off. Running turns
 * keep the snapshot they started with; the next request sees the change.
 */
import {
  defineExtension,
  type Extension,
  type Registry,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { McpServerView } from "@ultiv/ext";
import type { McpMindDeps } from "./access.ts";
import {
  CONNECTOR_LOAD,
  CONNECTOR_RESOURCES,
  connectorTools,
  connectorsSection,
} from "./connector-tools.ts";
import { serverTools } from "./tools.ts";

export const MCP_EXTENSION = "ultiv.mcp";

const extensionNameOf = (view: McpServerView): string =>
  `${MCP_EXTENSION}.${view.record.owner}.${view.record.id}`;

const signatureOf = (view: McpServerView): string =>
  JSON.stringify([
    view.record.name,
    view.tools.map((tool) => [
      tool.name,
      tool.enabled,
      tool.description,
      tool.readOnly,
      tool.destructive,
      tool.inputSchema,
    ]),
  ]);

export interface McpWiring {
  /** Every connector tool registration, for per-bot allowlists. */
  readonly allowlistTools: () => readonly ToolRegistration[];
  /** Allowlisting any connector tool implies the helper tools. */
  readonly implied: (allowlist: readonly string[]) => readonly string[];
  /** Re-sync the registry now (the manager's change feed also does). */
  readonly sync: () => void;
  readonly close: () => void;
}

export const wireMcp = (registry: Registry, deps: McpMindDeps): McpWiring => {
  const installed = new Map<string, string>();
  const sync = (): void => {
    const next = new Set<string>();
    for (const view of deps.manager.views()) {
      const name = extensionNameOf(view);
      next.add(name);
      const signature = signatureOf(view);
      if (installed.get(name) === signature) continue;
      registry.install(defineExtension({ name, tools: serverTools(deps, view) }));
      installed.set(name, signature);
    }
    for (const name of installed.keys()) {
      if (next.has(name)) continue;
      registry.uninstall(defineExtension({ name }) as Extension);
      installed.delete(name);
    }
  };
  registry.install(
    defineExtension({
      name: MCP_EXTENSION,
      tools: connectorTools(deps),
      sections: [connectorsSection(deps)],
    }),
  );
  sync();
  const unsubscribe = deps.manager.subscribe(sync);
  const helpers = connectorTools(deps);
  return {
    allowlistTools: () => [
      ...helpers,
      ...deps.manager.views().flatMap((view) => serverTools(deps, view)),
    ],
    implied: (allowlist) => {
      const names = new Set(
        deps.manager.views().flatMap((view) => view.tools.map((tool) => tool.name)),
      );
      return allowlist.some((name) => names.has(name)) ? [CONNECTOR_LOAD, CONNECTOR_RESOURCES] : [];
    },
    sync,
    close: unsubscribe,
  };
};
