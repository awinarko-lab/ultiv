/**
 * Transport construction for one server: stdio (a command, no shell),
 * Streamable HTTP, or legacy HTTP+SSE. Header secrets ride `requestInit`;
 * OAuth rides the SDK's `authProvider`. Nothing here logs a header value.
 */
import { SSEClientTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { OAuthClientProvider, Transport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { McpServerRecord } from "./config.ts";
import { scrubbedEnv } from "./env.ts";
import type { ResolvedSecrets } from "./secrets.ts";

export type ConcreteTransport = "http" | "sse" | "stdio";

/** The transports to try, in order: `auto` is Streamable HTTP, then legacy SSE. */
export const transportPlan = (record: McpServerRecord): readonly ConcreteTransport[] =>
  record.transport === "auto" ? ["http", "sse"] : [record.transport];

export interface BuiltTransport {
  readonly transport: Transport;
  /** stdio only: the last stderr lines (unscrubbed; scrub before showing). */
  readonly stderrTail: () => string;
  readonly pid: () => number | null;
}

const STDERR_TAIL = 2_000;

export const buildTransport = (
  kind: ConcreteTransport,
  record: McpServerRecord,
  secrets: ResolvedSecrets,
  extra: { readonly cwd: () => string; readonly oauth: OAuthClientProvider | null },
): BuiltTransport => {
  if (kind === "stdio") {
    const command = record.command;
    if (command === null) throw new Error("no command configured");
    const transport = new StdioClientTransport({
      command: command.command,
      args: [...command.args],
      env: scrubbedEnv(secrets.env),
      cwd: extra.cwd(),
      stderr: "pipe",
    });
    let tail = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      tail = (tail + chunk.toString("utf8")).slice(-STDERR_TAIL);
    });
    return { transport, stderrTail: () => tail, pid: () => transport.pid };
  }
  const url = new URL(record.url ?? "");
  const options = {
    requestInit: { headers: { ...secrets.headers } },
    ...(extra.oauth !== null ? { authProvider: extra.oauth } : {}),
  };
  const transport =
    kind === "http"
      ? new StreamableHTTPClientTransport(url, options)
      : new SSEClientTransport(url, options);
  return { transport, stderrTail: () => "", pid: () => null };
};
