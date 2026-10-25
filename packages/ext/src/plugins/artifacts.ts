/**
 * The artifact workspace: the entity's files, and the app's uploads — one
 * flat store on disk (blob + JSON sidecar per artifact) with model-facing
 * tools and the REST surface the server serves raw bytes from. Each artifact
 * records the conversation that wrote it, so `artifact_list` defaults to the
 * current conversation and can search the whole workspace on request.
 * Metadata lives in the sidecar, so list/read need no database; ids are
 * UUIDs and are re-validated before ever touching a path.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import type { Static } from "typebox";
import { ArtifactInfoSchema } from "@ultiv/contracts";
import type { ArtifactInfo } from "@ultiv/contracts";
import { definePlugin, toolCapability, type Plugin } from "../plugin.ts";
import { defineTool, type Tool } from "../tool.ts";

/** The workspace directory (relative to the server's cwd, like HARNESS_DB). */
export const artifactsDir = (): string => {
  const configured = process.env.ARTIFACTS_DIR?.trim();
  return configured !== undefined && configured !== "" ? configured : "var/artifacts";
};

const MAX_ID_CHARS = 64;
const MAX_READ_CHARS = 100_000;
const MAX_WRITE_CHARS = 1_000_000;

const validId = (id: string): boolean =>
  id.length > 0 && id.length <= MAX_ID_CHARS && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id);

const sidecarOf = (dir: string, id: string): string => join(dir, `${id}.json`);
const blobOf = (dir: string, id: string): string => join(dir, `${id}.bin`);

const mimes: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

export const mimeOfName = (name: string): string => {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  return mimes[ext] ?? "application/octet-stream";
};

export interface ArtifactWrite {
  readonly name: string;
  readonly mime?: string;
  readonly content: string;
  /** The conversation writing the file; null for app uploads without a session. */
  readonly conversationId?: string | null;
  /** The owner the artifact belongs to; null = unscoped (legacy behavior). */
  readonly owner?: string | null;
  /** The profile workspace the artifact belongs to; null = unscoped. */
  readonly profile?: string | null;
}

/** Store one artifact (UTF-8 text); returns its metadata. */
export const writeArtifact = (dir: string, input: ArtifactWrite): ArtifactInfo => {
  const id = randomUUID();
  mkdirSync(dir, { recursive: true });
  const bytes = Buffer.byteLength(input.content, "utf8");
  const info: ArtifactInfo = {
    id,
    name: input.name.trim() === "" ? id : input.name.trim().slice(0, 200),
    mime: input.mime ?? mimeOfName(input.name),
    bytes,
    createdAt: Date.now(),
    conversationId: input.conversationId ?? null,
    owner: input.owner ?? null,
    profile: input.profile ?? null,
  };
  writeFileSync(blobOf(dir, id), input.content, "utf8");
  writeFileSync(sidecarOf(dir, id), JSON.stringify(info));
  return info;
};

/** Legacy sidecars predate `conversationId` and profile scoping; normalize on every read. */
const normalize = (raw: ArtifactInfo): ArtifactInfo => ({
  ...raw,
  conversationId: raw.conversationId ?? null,
  owner: raw.owner ?? null,
  profile: raw.profile ?? null,
});

/** Read one artifact's metadata and text (UTF-8, capped); undefined when absent. */
export const readArtifact = (
  dir: string,
  id: string,
): { info: ArtifactInfo; text: string } | undefined => {
  if (!validId(id)) return undefined;
  const sidecar = sidecarOf(dir, id);
  if (!existsSync(sidecar)) return undefined;
  const info = normalize(JSON.parse(readFileSync(sidecar, "utf8")) as ArtifactInfo);
  const text = readFileSync(blobOf(dir, id), "utf8");
  return { info, text: text.length > MAX_READ_CHARS ? text.slice(0, MAX_READ_CHARS) : text };
};

/** The absolute path of an artifact's bytes, for raw serving; undefined when absent. */
export const artifactFile = (dir: string, id: string): string | undefined => {
  if (!validId(id)) return undefined;
  const blob = blobOf(dir, id);
  return existsSync(blob) ? blob : undefined;
};

export const readArtifactInfo = (dir: string, id: string): ArtifactInfo | undefined => {
  if (!validId(id)) return undefined;
  const sidecar = sidecarOf(dir, id);
  if (!existsSync(sidecar)) return undefined;
  return normalize(JSON.parse(readFileSync(sidecar, "utf8")) as ArtifactInfo);
};

/** Delete one artifact (blob + sidecar); false when it was not there. */
export const deleteArtifact = (dir: string, id: string): boolean => {
  if (!validId(id) || !existsSync(sidecarOf(dir, id))) return false;
  rmSync(sidecarOf(dir, id), { force: true });
  rmSync(blobOf(dir, id), { force: true });
  return true;
};

/** Delete every artifact; returns how many were removed. Owner-level, not a tool. */
export const clearArtifacts = (dir: string): number => {
  if (!existsSync(dir)) return 0;
  const sidecars = readdirSync(dir).filter((file) => file.endsWith(".json"));
  for (const file of sidecars) {
    const id = file.slice(0, -".json".length);
    rmSync(sidecarOf(dir, id), { force: true });
    rmSync(blobOf(dir, id), { force: true });
  }
  return sidecars.length;
};

/** All artifacts, newest first. */
export const listArtifacts = (dir: string): readonly ArtifactInfo[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      try {
        return [normalize(JSON.parse(readFileSync(join(dir, file), "utf8")) as ArtifactInfo)];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt);
};

export interface ArtifactFilter {
  /** Only artifacts written by this conversation. */
  readonly conversationId?: string | null;
  /** Substring match on the name and the (capped) text content, case-insensitive. */
  readonly query?: string;
}

/** List + filter: the search half of the workspace. */
export const searchArtifacts = (
  dir: string,
  filter: ArtifactFilter = {},
): readonly ArtifactInfo[] => {
  const query = filter.query?.trim().toLowerCase() ?? "";
  return listArtifacts(dir).filter((info) => {
    if (
      filter.conversationId !== undefined &&
      filter.conversationId !== null &&
      info.conversationId !== filter.conversationId
    ) {
      return false;
    }
    if (query === "") return true;
    if (info.name.toLowerCase().includes(query)) return true;
    const found = readArtifact(dir, info.id);
    return found !== undefined && found.text.toLowerCase().includes(query);
  });
};

const ArtifactInfoShape = ArtifactInfoSchema;

const WriteParams = Type.Object({
  name: Type.String({ description: 'File name, e.g. "report.md" — the extension sets the type.' }),
  content: Type.String({
    description: `The file's UTF-8 content, up to ${MAX_WRITE_CHARS} chars.`,
  }),
});

const artifactWriteTool = (dir: string): Tool =>
  defineTool({
    name: "artifact_write",
    gated: true,
    description:
      "Write a file into the workspace the app can serve: reports, data, code, anything the " +
      "user should keep. Returns the artifact id clients fetch it by.",
    parameters: WriteParams,
    structuredOutputSchema: Type.Object({ id: Type.String(), name: Type.String() }),
    execute: (args, api) => {
      if (args.content.length > MAX_WRITE_CHARS) {
        return Promise.resolve({
          output: [{ type: "text" as const, text: `content exceeds ${MAX_WRITE_CHARS} chars` }],
          isError: true as const,
        });
      }
      const info = writeArtifact(dir, {
        name: args.name,
        content: args.content,
        conversationId: String(api.conversationId),
      });
      return Promise.resolve({
        output: [{ type: "text" as const, text: `artifact ${info.id} (${info.name})` }],
        structuredOutput: { id: info.id, name: info.name },
      });
    },
  });

const artifactReadTool = (dir: string): Tool =>
  defineTool({
    name: "artifact_read",
    description: "Read a workspace artifact's content by id (UTF-8, capped).",
    parameters: Type.Object({ id: Type.String({ description: "The artifact id." }) }),
    execute: (args) => {
      const found = readArtifact(dir, args.id);
      if (found === undefined) {
        return Promise.resolve({
          output: [{ type: "text" as const, text: `unknown artifact: ${args.id}` }],
          isError: true as const,
        });
      }
      return Promise.resolve({
        output: [{ type: "text" as const, text: `# ${found.info.name}\n\n${found.text}` }],
      });
    },
  });

const ListParams = Type.Object({
  query: Type.Optional(
    Type.String({ description: "Search artifact names and text content (case-insensitive)." }),
  ),
  scope: Type.Optional(
    Type.Union([Type.Literal("session"), Type.Literal("all")], {
      description:
        '"session" (default): only this conversation\'s artifacts. "all": search the whole ' +
        "workspace — use it when the file was not written in this conversation.",
    }),
  ),
});

const artifactListTool = (dir: string): Tool =>
  defineTool({
    name: "artifact_list",
    description:
      "List or search the workspace's artifacts (id, name, type, size, recency). Defaults to " +
      'THIS conversation\'s artifacts; widen with scope "all" when needed.',
    parameters: ListParams,
    structuredOutputSchema: Type.Array(ArtifactInfoShape),
    execute: (args, api) => {
      const scopeAll = args.scope === "all";
      const items = searchArtifacts(dir, {
        ...(scopeAll ? {} : { conversationId: String(api.conversationId) }),
        ...(args.query !== undefined ? { query: args.query } : {}),
      });
      const rows = items.map((item) => ({ ...item }));
      return Promise.resolve({
        output: [{ type: "text" as const, text: JSON.stringify(items) }],
        structuredOutput: rows,
      });
    },
  });

const artifactDeleteTool = (dir: string): Tool =>
  defineTool({
    name: "artifact_delete",
    gated: true,
    description: "Delete one workspace artifact by id. Destructive; the user approves each call.",
    parameters: Type.Object({ id: Type.String({ description: "The artifact id." }) }),
    execute: (args) => {
      const deleted = deleteArtifact(dir, args.id);
      if (!deleted) {
        return Promise.resolve({
          output: [{ type: "text" as const, text: `unknown artifact: ${args.id}` }],
          isError: true as const,
        });
      }
      return Promise.resolve({
        output: [{ type: "text" as const, text: `deleted ${args.id}` }],
        structuredOutput: { id: args.id, deleted: true },
      });
    },
  });

export type ArtifactWriteInput = Static<typeof WriteParams>;

/** The workspace plugin: always on; the store is the server's shared dir. */
export const artifactsPlugin = (dir: string = artifactsDir()): Plugin =>
  definePlugin({
    id: "ultiv.artifacts",
    version: "1.1.0",
    description:
      "The artifact workspace: gated writes and deletes, reads, and session-scoped search.",
    capabilities: [
      toolCapability(artifactWriteTool(dir)),
      toolCapability(artifactReadTool(dir)),
      toolCapability(artifactListTool(dir)),
      toolCapability(artifactDeleteTool(dir)),
    ],
  });
