/**
 * The Registry: plugins install here, capabilities resolve here. Identities
 * (plugin id, tool name, connector id) are unique across the registry — the
 * validation happens at build time, so a bad composition fails to boot, not
 * at first use.
 */
import { Context, Effect, Layer } from "effect";
import { Duplicate } from "@ultiv/core";
import type { Connector } from "./connector.ts";
import type { Plugin } from "./plugin.ts";
import type { Tool } from "./tool.ts";

export interface RegistryService {
  /** Install a plugin; fails on any identity the registry already holds. */
  readonly register: (plugin: Plugin) => Effect.Effect<void, Duplicate>;
  readonly plugins: () => readonly Plugin[];
  readonly tools: () => readonly Tool[];
  readonly connector: (id: string) => Connector | undefined;
}

export class Registry extends Context.Service<Registry, RegistryService>()("ultiv/ext/Registry") {}

interface RegistryState {
  plugins: Plugin[];
  pluginIds: Set<string>;
  toolNames: Set<string>;
  connectors: Map<string, Connector>;
}

const registerInto = (state: RegistryState, plugin: Plugin): Effect.Effect<void, Duplicate> =>
  Effect.gen(function* () {
    if (state.pluginIds.has(plugin.id)) {
      return yield* new Duplicate({ kind: "plugin", id: plugin.id });
    }
    for (const capability of plugin.capabilities) {
      if (capability.kind === "tool") {
        if (state.toolNames.has(capability.tool.name)) {
          return yield* new Duplicate({ kind: "tool", id: capability.tool.name });
        }
      } else if (state.connectors.has(capability.connector.id)) {
        return yield* new Duplicate({ kind: "connector", id: capability.connector.id });
      }
    }
    // Commit only after the whole plugin validated.
    state.pluginIds.add(plugin.id);
    state.plugins.push(plugin);
    for (const capability of plugin.capabilities) {
      if (capability.kind === "tool") state.toolNames.add(capability.tool.name);
      else state.connectors.set(capability.connector.id, capability.connector);
    }
  });

export const makeRegistry = (
  plugins: readonly Plugin[],
): Effect.Effect<RegistryService, Duplicate> =>
  Effect.gen(function* () {
    const state: RegistryState = {
      plugins: [],
      pluginIds: new Set(),
      toolNames: new Set(),
      connectors: new Map(),
    };
    const service: RegistryService = {
      register: (plugin) => registerInto(state, plugin),
      plugins: () => [...state.plugins],
      tools: () =>
        state.plugins
          .flatMap((plugin) => plugin.capabilities)
          .flatMap((capability) => (capability.kind === "tool" ? [capability.tool] : [])),
      connector: (id) => state.connectors.get(id),
    };
    for (const plugin of plugins) yield* registerInto(state, plugin);
    return service;
  });

/** A registry preloaded with plugins; duplicate identities fail the build. */
export const registryLayer = (plugins: readonly Plugin[]): Layer.Layer<Registry, Duplicate> =>
  Layer.effect(Registry, makeRegistry(plugins));
