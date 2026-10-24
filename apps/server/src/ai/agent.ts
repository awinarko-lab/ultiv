import { defineExtension, type AgentChange, type Extension } from "@earendil-works/pi-durable";
import { jevAskTool, jevPickTool, jevRateTool, jevScoreTool } from "./jev-tools.ts";
import { kenariAgent } from "./kenari.ts";

/**
 * The app's native agent: the LLM reasons, Jev decides. Both are env-keyed and
 * swappable — this composition point is the only place that knows the lineup.
 */
export function defaultAgent(): AgentChange {
  return { ...kenariAgent() };
}

/**
 * Jev as native decision tools of the agent loop. Install into the harness
 * registry; unset `tools` in an agent then enables them for every
 * conversation. Absent without a key.
 */
export function jevExtension(): Extension | undefined {
  if (process.env.TYPESAFE_API_KEY === undefined) return undefined;
  return defineExtension({
    name: "typesafe",
    tools: [jevScoreTool(), jevPickTool(), jevRateTool(), jevAskTool()],
  });
}
