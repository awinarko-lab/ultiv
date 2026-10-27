/**
 * Bot-facing names for MCP tools: `<server>_<tool>`, restricted to the
 * provider-safe `[a-zA-Z0-9_-]{1,64}`. A name that had to be shortened or
 * that collides gets a short stable hash suffix, so two remote tools never
 * share one bot-facing name.
 */
import { createHash } from "node:crypto";

/** Provider tool-name ceiling (OpenAI/Anthropic accept 64). */
export const MAX_TOOL_NAME = 64;
const MAX_SLUG = 24;

const clean = (text: string): string =>
  text
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");

/** A server label as a tool-name prefix: lowercase, `[a-z0-9_]`, at most 24 chars. */
export const slugOf = (name: string): string => {
  const slug = clean(name.toLowerCase()).replace(/-/g, "_").slice(0, MAX_SLUG).replace(/_+$/, "");
  return slug === "" ? "mcp" : slug;
};

const shortHash = (text: string): string =>
  createHash("sha256").update(text).digest("hex").slice(0, 6);

/**
 * The bot-facing name of one remote tool. `taken` holds names already handed
 * out (this server and every other); the result is added to it.
 */
export const toolNameOf = (slug: string, remote: string, taken: Set<string>): string => {
  const tool = clean(remote) || "tool";
  const plain = `${slug}_${tool}`;
  let name = plain;
  if (plain.length > MAX_TOOL_NAME || taken.has(plain)) {
    const suffix = `_${shortHash(`${slug}\u0000${remote}`)}`;
    name = `${plain.slice(0, MAX_TOOL_NAME - suffix.length).replace(/[_-]+$/, "")}${suffix}`;
  }
  for (let n = 2; taken.has(name); n++) {
    const suffix = `_${n}`;
    name = `${name.slice(0, MAX_TOOL_NAME - suffix.length)}${suffix}`;
  }
  taken.add(name);
  return name;
};

/** A slug not used by any other server (suffix `_2`, `_3`, …). */
export const uniqueSlug = (name: string, used: ReadonlySet<string>): string => {
  const base = slugOf(name);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, MAX_SLUG - String(n).length - 1)}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
};
