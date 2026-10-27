/**
 * Known connectors a bot can add by id. Only servers whose URL was checked
 * against the provider's own docs belong here (context7: upstash/context7
 * README; deepwiki: docs.devin.ai; linear: linear.app/docs/mcp; notion:
 * developers.notion.com). Adding still goes through the owner's card.
 */
export type PresetKey = "none" | "optional" | "oauth";

export interface McpPreset {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly about: string;
  /** none: keyless; optional: works keyless, a key raises limits; oauth: sign in. */
  readonly key: PresetKey;
  /** Where an optional key goes. */
  readonly header?: { readonly name: string; readonly prefix: string };
}

export const MCP_PRESETS: readonly McpPreset[] = [
  {
    id: "context7",
    name: "context7",
    url: "https://mcp.context7.com/mcp",
    about: "Up-to-date library and framework docs. Free without a key; a key raises rate limits.",
    key: "optional",
    header: { name: "Authorization", prefix: "Bearer " },
  },
  {
    id: "deepwiki",
    name: "deepwiki",
    url: "https://mcp.deepwiki.com/mcp",
    about: "Ask about public GitHub repositories. Free, no key.",
    key: "none",
  },
  {
    id: "linear",
    name: "linear",
    url: "https://mcp.linear.app/mcp",
    about: "Linear issues and projects. The owner signs in on the Connectors screen.",
    key: "oauth",
  },
  {
    id: "notion",
    name: "notion",
    url: "https://mcp.notion.com/mcp",
    about: "Notion pages and databases. The owner signs in on the Connectors screen.",
    key: "oauth",
  },
];

export const presetById = (id: string): McpPreset | undefined =>
  MCP_PRESETS.find((preset) => preset.id === id.trim().toLowerCase());
