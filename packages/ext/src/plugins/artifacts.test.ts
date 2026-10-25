import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  artifactFile,
  listArtifacts,
  mimeOfName,
  readArtifact,
  writeArtifact,
} from "./artifacts.ts";

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "ultiv-artifacts-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe("Artifact store", () => {
  it("writes, lists newest-first and reads back", async () => {
    const dir = tempDir();
    const first = writeArtifact(dir, { name: "notes.md", content: "# hello" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = writeArtifact(dir, { name: "data.json", content: "{}" });
    expect(second.createdAt).toBeGreaterThan(first.createdAt);
    expect(listArtifacts(dir).map((info) => info.id)).toEqual([second.id, first.id]);
    const found = readArtifact(dir, first.id);
    expect(found?.text).toBe("# hello");
    expect(found?.info.mime).toBe("text/markdown");
    expect(artifactFile(dir, first.id)).toContain(`${first.id}.bin`);
  });

  it("refuses path-shaped ids and reports unknown ones", () => {
    const dir = tempDir();
    writeArtifact(dir, { name: "a.txt", content: "x" });
    expect(readArtifact(dir, "../escape")).toBeUndefined();
    expect(artifactFile(dir, "missing")).toBeUndefined();
    expect(listArtifacts(dir)).toHaveLength(1);
  });

  it("maps mime from the name and accepts an explicit override", () => {
    expect(mimeOfName("photo.PNG")).toBe("image/png");
    const dir = tempDir();
    const info = writeArtifact(dir, { name: "blob", mime: "text/csv", content: "a,b" });
    expect(info.mime).toBe("text/csv");
  });
});
