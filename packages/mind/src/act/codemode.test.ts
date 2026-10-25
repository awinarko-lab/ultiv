import { describe, expect, it } from "vite-plus/test";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";

const sandboxWithDemoTool = async (): Promise<CodemodeSandbox> => {
  const sandbox = new CodemodeSandbox();
  sandbox.registerTool({
    name: "demo",
    description: "Returns the number doubled.",
    inputSchema: { type: "object", properties: { n: { type: "number" } } },
    outputSchema: { type: "object", properties: { value: { type: "number" } } },
    execute: async (args) => ({ value: ((args as { n?: number }).n ?? 0) * 2 }),
  });
  return sandbox;
};

describe("Codemode sandbox (real QuickJS)", () => {
  it("composes concurrent tool calls and returns the reduced value", async () => {
    const sandbox = await sandboxWithDemoTool();
    const result = await sandbox.execute(`
      const pairs = await Promise.all([tools.demo({ n: 1 }), tools.demo({ n: 2 }), tools.demo({ n: 3 })]);
      return pairs.map((pair) => pair.value).join("+");
    `);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toBe("2+4+6");
  });

  it("reads the seeded store and reports its own writes", async () => {
    const sandbox = await sandboxWithDemoTool();
    const read = await sandbox.execute(`return load("seen");`, { store: { seen: 41 } });
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value).toBe(41);
    const write = await sandbox.execute(`store("k", [1, 2]); return "done";`);
    if (!write.ok) throw new Error(write.error.message);
    expect(write.storeWrites.set).toEqual({ k: [1, 2] });
  });

  it("surfaces script errors without throwing", async () => {
    const sandbox = await sandboxWithDemoTool();
    const result = await sandbox.execute(`throw new Error("no can do");`);
    if (result.ok) throw new Error("expected the script to fail");
    expect(result.error.message).toContain("no can do");
  });
});
