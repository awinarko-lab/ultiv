import { describe, expect, it, afterAll } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashPlugin } from "./bash.ts";
import { listArtifacts, readArtifact } from "../plugins/artifacts.ts";

const dir = mkdtempSync(join(tmpdir(), "ultiv-bash-"));
const api = { conversationId: "conv-1" } as never;

describe("bash tool (durable workspace)", () => {
  it("runs scripts, persists files as artifacts, and carries cwd", async () => {
    const plugin = bashPlugin({ root: dir });
    const capability = plugin.capabilities[0];
    if (capability?.kind !== "tool") throw new Error("missing bash tool");
    const bash = capability.tool;
    expect(bash.name).toBe("bash");
    // Destructive by reach (rm/mv over artifacts): the act gates it.
    expect(bash.gated).toBe(true);

    const write = await bash.execute(
      { script: 'echo "hello durable" > greeting.txt && mkdir -p src && date > src/when.txt' },
      api,
      {} as never,
    );
    expect(write.isError).toBeUndefined();

    // The file is a real artifact in the store.
    const list = listArtifacts(dir);
    const greeting = list.find((info) => info.name === "greeting.txt");
    expect(greeting).toBeDefined();
    const found = readArtifact(dir, (greeting as { id: string }).id);
    expect(found?.text.trim()).toBe("hello durable");

    // A SECOND tool call — and a fresh process — sees the files.
    const read = await bash.execute({ script: "cat greeting.txt" }, api, {} as never);
    expect(read.structuredOutput).toMatchObject({ stdout: "hello durable\n", exitCode: 0 });

    const reborn = bashPlugin({ root: dir });
    const rebornTool = reborn.capabilities[0];
    if (rebornTool?.kind !== "tool") throw new Error("missing bash tool");
    const again = await rebornTool.tool.execute({ script: "cat greeting.txt" }, api, {} as never);
    expect(again.structuredOutput).toMatchObject({ stdout: "hello durable\n" });

    // cd carries over between calls on the same session.
    await bash.execute({ script: "cd src" }, api, {} as never);
    const pwd = await bash.execute({ script: "pwd" }, api, {} as never);
    expect(pwd.structuredOutput).toMatchObject({ stdout: "/home/src\n" });
  });

  it("reports failures as errors and truncates huge output", async () => {
    const plugin = bashPlugin({ root: dir });
    const capability = plugin.capabilities[0];
    if (capability?.kind !== "tool") throw new Error("missing bash tool");
    const missing = await capability.tool.execute({ script: "cat /nope.txt" }, api, {} as never);
    // A failing COMMAND is not a failing tool: the exit code and stderr carry it.
    expect(missing.isError).toBeUndefined();
    expect(missing.structuredOutput).toMatchObject({ exitCode: 1 });
    expect((missing.output?.[0] as { text: string }).text).toContain("stderr");

    const big = await capability.tool.execute({ script: "seq 1 100000" }, api, {} as never);
    expect(big.isError).toBeUndefined();
    const text = (big.output?.[0] as { text: string }).text;
    expect(text).toContain("truncated");
  });

  it("has no network egress", async () => {
    const plugin = bashPlugin({ root: dir });
    const capability = plugin.capabilities[0];
    if (capability?.kind !== "tool") throw new Error("missing bash tool");
    const result = await capability.tool.execute(
      { script: "curl https://example.com" },
      api,
      {} as never,
    );
    expect(result.structuredOutput).toMatchObject({ exitCode: 127 }); // command not found
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));
});
