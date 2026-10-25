/**
 * A plugin is the unit of extension: a named, versioned bundle of
 * capabilities. New capability kinds (routes, providers, …) extend the union
 * without reshaping plugins, so the standard is stable as the platform grows.
 */
import type { PromptSection } from "@earendil-works/pi-durable";
import type { Connector } from "./connector.ts";
import type { Tool } from "./tool.ts";

export type Capability =
  | { readonly kind: "tool"; readonly tool: Tool }
  | { readonly kind: "connector"; readonly connector: Connector }
  | { readonly kind: "section"; readonly section: PromptSection };

export interface Plugin {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly capabilities: readonly Capability[];
}

export const definePlugin = (plugin: Plugin): Plugin => plugin;

export const toolCapability = (tool: Tool): Capability => ({ kind: "tool", tool });

export const connectorCapability = (connector: Connector): Capability => ({
  kind: "connector",
  connector,
});

export const sectionCapability = (section: PromptSection): Capability => ({
  kind: "section",
  section,
});
