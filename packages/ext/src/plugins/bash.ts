/**
 * The bash faculty: a real shell over the durable workspace. Scripts run in
 * just-bash (no VM, no network, no python/js) against a DurableFs mounted at
 * `/home` — pipes, grep, jq, sqlite3, coreutils — and every file they touch
 * IS an artifact: visible in `artifact_list`, served by the web UI, kept
 * across restarts. Not gated: writes land in the entity's own workspace,
 * exactly like artifact_write.
 */
import { Bash, InMemoryFs, MountableFs, type BashExecResult } from "just-bash";
import { Type } from "typebox";
import { definePlugin, toolCapability, type Plugin } from "../plugin.ts";
import { defineTool, type Tool } from "../tool.ts";
import { DurableFs } from "../fs/durable-fs.ts";
import { scopeDir, type ScopeHolder } from "./vault.ts";
import { artifactsDir } from "./artifacts.ts";

const MAX_OUTPUT_CHARS = 20_000;
const HOME = "/home";

export interface BashOptions {
  /** Workspace root; default ARTIFACTS_DIR. */
  readonly root?: string;
  /** Profile-scope resolver; when set, each conversation works in its profile's tree. */
  readonly holder?: ScopeHolder;
}

interface Session {
  readonly bash: Bash;
  readonly fs: DurableFs;
  cwd: string;
}

const truncate = (text: string): string => {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n… [truncated ${text.length - MAX_OUTPUT_CHARS} chars]`;
};

/** Exec-boundary marker that reports the script's final working directory. */
const CWD_MARKER = "__ULTIV_CWD__";

const sessionFor = (
  sessions: Map<string, Session>,
  key: string,
  dirOf: (conversationId: string) => string,
  conversationId: string,
): Session => {
  const existing = sessions.get(key);
  if (existing !== undefined) return existing;
  const fs = new DurableFs({ dir: dirOf(conversationId), conversationId });
  const mountable = new MountableFs({ base: new InMemoryFs() });
  mountable.mount(HOME, fs);
  const bash = new Bash({ fs: mountable, cwd: HOME, env: { HOME } });
  const session: Session = { bash, fs, cwd: HOME };
  sessions.set(key, session);
  return session;
};

const Params = Type.Object({
  script: Type.String({ description: "The bash script to run. Files persist in your workspace." }),
});

const bashTool = (
  dirOf: (conversationId: string) => string,
  sessions: Map<string, Session>,
): Tool =>
  defineTool({
    name: "bash",
    description:
      `Run a bash script in your durable workspace, mounted at ${HOME} (the working ` +
      "directory). Real coreutils — pipes, grep, sed, awk, jq, sqlite3, tar — but NO " +
      "network, python or node. Every file you create or change under " +
      HOME +
      " is an " +
      "artifact: it persists across restarts and the user can see it. Working directory " +
      "carries over between calls. Not approval-gated: do not delete or overwrite files " +
      "you did not create for the current task without your owner's go-ahead.",
    parameters: Params,
    structuredOutputSchema: Type.Object({
      stdout: Type.String(),
      stderr: Type.String(),
      exitCode: Type.Number(),
    }),
    execute: async (args, api) => {
      const conversationId = String(api.conversationId);
      const session = sessionFor(sessions, dirOf(conversationId), dirOf, conversationId);
      let result: BashExecResult;
      try {
        // The marker rides stderr; the script's own exit code is preserved.
        result = await session.bash.exec(
          `${args.script}\n__ULTIV_RC__=$?\necho "${CWD_MARKER}$PWD" 1>&2\nexit $__ULTIV_RC__`,
          { cwd: session.cwd },
        );
      } catch (cause) {
        return {
          output: [{ type: "text" as const, text: `bash failed: ${String(cause)}` }],
          isError: true as const,
        };
      }
      const marker = result.stderr
        .split("\n")
        .reverse()
        .find((line) => line.startsWith(CWD_MARKER));
      if (marker !== undefined && marker.slice(CWD_MARKER.length).startsWith("/")) {
        session.cwd = marker.slice(CWD_MARKER.length);
      }
      const stderr = truncate(
        result.stderr
          .split("\n")
          .filter((line) => !line.startsWith(CWD_MARKER))
          .join("\n")
          .replace(/^\n/, ""),
      );
      const stdout = truncate(result.stdout);
      const parts = [
        ...(stdout === "" ? [] : [stdout]),
        ...(stderr === "" ? [] : [`[stderr] ${stderr}`]),
      ];
      return {
        output: [
          {
            type: "text" as const,
            text: parts.length === 0 ? `(exit ${result.exitCode}, no output)` : parts.join("\n"),
          },
        ],
        structuredOutput: { stdout, stderr, exitCode: result.exitCode },
      };
    },
  });

/** The bash plugin: the durable workspace as a shell filesystem. */
export const bashPlugin = (options: BashOptions = {}): Plugin => {
  const root = options.root ?? artifactsDir();
  const holder = options.holder;
  const dirOf = (conversationId: string): string =>
    holder === undefined ? root : scopeDir(holder, conversationId, root);
  // Keyed by SCOPE DIRECTORY, not conversation: one shared tree per profile,
  // so every conversation of a bot sees the same durable files.
  return definePlugin({
    id: "ultiv.bash",
    version: "1.0.0",
    description: "A real bash shell over the durable workspace — files written here are artifacts.",
    capabilities: [toolCapability(bashTool(dirOf, new Map()))],
  });
};
