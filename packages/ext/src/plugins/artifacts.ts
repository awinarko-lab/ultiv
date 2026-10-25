/**
 * The artifact workspace: the entity's files, and the app's uploads — one
 * flat store on disk (blob + JSON sidecar per artifact) with model-facing
 * tools (`artifact_write` is gated: it produces files users can fetch) and
 * the REST surface the server serves raw bytes from. Metadata lives in the
 * sidecar, so list/read need no database; ids are UUIDs and are re-validated
 * before ever touching a path.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import type { Static } from "typebox";
import { definePlugin, toolCapability, type Plugin } from "../plugin.ts";
import { defineTool, type Tool } from "../tool.ts";
import type { ArtifactInfo } from "@ultiv/contracts";

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
  };
  writeFileSync(blobOf(dir, id), input.content, "utf8");
  writeFileSync(sidecarOf(dir, id), JSON.stringify(info));
  return info;
};

/** Read one artifact's metadata and text (UTF-8, capped); undefined when absent. */
export const readArtifact = (
  dir: string,
  id: string,
): { info: ArtifactInfo; text: string } | undefined => {
  if (!validId(id)) return undefined;
  const sidecar = sidecarOf(dir, id);
  if (!existsSync(sidecar)) return undefined;
  const info = JSON.parse(readFileSync(sidecar, "utf8")) as ArtifactInfo;
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
  return JSON.parse(readFileSync(sidecar, "utf8")) as ArtifactInfo;
};

/** All artifacts, newest first. */
export const listArtifacts = (dir: string): readonly ArtifactInfo[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      try {
        const info = JSON.parse(readFileSync(join(dir, file), "utf8")) as ArtifactInfo;
        return [info];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt);
};

const ArtifactInfoShape = Type.Object({
  id: Type.String(),
  name: Type.String(),
  mime: Type.String(),
  bytes: Type.Number(),
  createdAt: Type.Number(),
});

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
    execute: (args) => {
      if (args.content.length > MAX_WRITE_CHARS) {
        return Promise.resolve({
          output: [{ type: "text" as const, text: `content exceeds ${MAX_WRITE_CHARS} chars` }],
          isError: true as const,
        });
      }
      const info = writeArtifact(dir, { name: args.name, content: args.content });
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

const artifactListTool = (dir: string): Tool =>
  defineTool({
    name: "artifact_list",
    description: "List the workspace's artifacts: id, name, type, size, recency.",
    parameters: Type.Object({}),
    structuredOutputSchema: Type.Array(ArtifactInfoShape),
    execute: () => {
      const items = listArtifacts(dir);
      const rows = items.map((item) => ({ ...item }));
      return Promise.resolve({
        output: [{ type: "text" as const, text: JSON.stringify(items) }],
        structuredOutput: rows,
      });
    },
  });

export type ArtifactWriteInput = Static<typeof WriteParams>;

/** The workspace plugin: always on; the store is the server's shared dir. */
export const artifactsPlugin = (dir: string = artifactsDir()): Plugin =>
  definePlugin({
    id: "ultiv.artifacts",
    version: "1.0.0",
    description:
      "The artifact workspace: gated writes plus reads and listings of the entity's files.",
    capabilities: [
      toolCapability(artifactWriteTool(dir)),
      toolCapability(artifactReadTool(dir)),
      toolCapability(artifactListTool(dir)),
    ],
  });
