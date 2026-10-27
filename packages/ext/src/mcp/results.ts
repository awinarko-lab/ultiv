/**
 * MCP tool results → harness tool results. Text, images, embedded resources,
 * resource links and structured content are kept; everything textual is
 * scrubbed of the server's secrets, capped, and fenced as untrusted data
 * (the content came from a third party and may carry injected instructions).
 */
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/client";

export type McpOutputPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

export interface McpConverted {
  readonly output: McpOutputPart[];
  readonly isError: boolean;
  /** JSON-safe structured content, when the server returned one. */
  readonly structured: unknown;
  /** True when anything was cut to fit the caps. */
  readonly truncated: boolean;
}

export interface ResultLimits {
  /** Total text characters kept across all parts. */
  readonly maxText: number;
  readonly maxImages: number;
  /** Base64 length cap per image. */
  readonly maxImageBase64: number;
}

export const DEFAULT_LIMITS: ResultLimits = {
  maxText: 60_000,
  maxImages: 4,
  maxImageBase64: 3_000_000,
};

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** The fence every MCP-sourced text rides in. */
export const fenceUntrusted = (source: string, text: string): string =>
  // A server cannot close the fence early: its own closing tags are defused.
  `<untrusted source="mcp:${source}">\n${text.replace(/<\/?untrusted/gi, "&lt;untrusted")}\n</untrusted>`;

type Block = CallToolResult["content"][number];

const describeBlock = (
  block: Block,
): { text?: string; image?: { data: string; mimeType: string } } => {
  switch (block.type) {
    case "text":
      return { text: block.text };
    case "image":
      return { image: { data: block.data, mimeType: block.mimeType } };
    case "audio":
      return { text: `[audio ${block.mimeType}, ${block.data.length} base64 chars, not shown]` };
    case "resource_link":
      return { text: `[resource ${block.name}: ${block.uri}]` };
    case "resource": {
      const resource = block.resource;
      return "text" in resource
        ? { text: `[resource ${resource.uri}]\n${resource.text}` }
        : { text: `[binary resource ${resource.uri}, ${resource.mimeType ?? "unknown type"}]` };
    }
    default:
      return { text: `[unsupported ${(block as { type: string }).type} content]` };
  }
};

const capText = (text: string, budget: { left: number }): { text: string; cut: boolean } => {
  if (text.length <= budget.left) {
    budget.left -= text.length;
    return { text, cut: false };
  }
  const kept = text.slice(0, Math.max(0, budget.left));
  budget.left = 0;
  return { text: `${kept}\n[… cut: ${text.length - kept.length} more characters]`, cut: true };
};

const scrubJson = (value: unknown, scrub: (text: string) => string): unknown => {
  try {
    return JSON.parse(scrub(JSON.stringify(value))) as unknown;
  } catch {
    return undefined;
  }
};

/** Convert one tool result; `scrub` removes the server's secret forms. */
export const convertToolResult = (
  source: string,
  result: CallToolResult,
  scrub: (text: string) => string,
  limits: ResultLimits = DEFAULT_LIMITS,
): McpConverted => {
  const budget = { left: limits.maxText };
  const texts: string[] = [];
  const images: McpOutputPart[] = [];
  let truncated = false;
  for (const block of result.content ?? []) {
    const { text, image } = describeBlock(block);
    if (text !== undefined) texts.push(text);
    if (image === undefined) continue;
    if (!IMAGE_TYPES.has(image.mimeType)) {
      texts.push(`[image ${image.mimeType} not shown: unsupported type]`);
    } else if (images.length >= limits.maxImages || image.data.length > limits.maxImageBase64) {
      texts.push(`[image ${image.mimeType} not shown: over the size or count cap]`);
      truncated = true;
    } else {
      images.push({ type: "image", data: image.data, mimeType: image.mimeType });
    }
  }
  const structured = result.structuredContent;
  if (structured !== undefined && texts.length === 0)
    texts.push(JSON.stringify(structured, null, 2));
  const capped = capText(scrub(texts.join("\n\n")), budget);
  truncated ||= capped.cut;
  const body = capped.text === "" ? "(no text content)" : capped.text;
  const safeStructured = structured === undefined ? undefined : scrubJson(structured, scrub);
  return {
    output: [{ type: "text", text: fenceUntrusted(source, body) }, ...images],
    isError: result.isError === true,
    structured: safeStructured,
    truncated,
  };
};

/** Convert a resources/read result to fenced text (binary is summarized). */
export const convertResource = (
  source: string,
  result: ReadResourceResult,
  scrub: (text: string) => string,
  limits: ResultLimits = DEFAULT_LIMITS,
): string => {
  const parts = result.contents.map((content) =>
    "text" in content
      ? `[${content.uri}${content.mimeType !== undefined ? ` ${content.mimeType}` : ""}]\n${content.text}`
      : `[binary ${content.uri} ${content.mimeType ?? ""}, ${content.blob.length} base64 chars]`,
  );
  const capped = capText(scrub(parts.join("\n\n")), { left: limits.maxText });
  return fenceUntrusted(source, capped.text === "" ? "(empty)" : capped.text);
};
