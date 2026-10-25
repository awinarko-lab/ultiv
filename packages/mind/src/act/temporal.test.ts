import { describe, expect, it } from "vite-plus/test";
import { nowTool } from "./temporal.ts";

describe("temporal tool", () => {
  it("grounds now in a requested zone", async () => {
    const result = await nowTool().execute({ timezone: "Asia/Jakarta" }, {} as never, {} as never);
    const output = result.structuredOutput as {
      utc: string;
      offsetMinutes: number;
      local: string;
      weekday: string;
    };
    expect(output.offsetMinutes).toBe(420); // WIB, no DST
    expect(output.local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(output.weekday.length).toBeGreaterThan(0);
    expect(output.utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("rejects an invalid zone as an error result", async () => {
    const result = await nowTool().execute({ timezone: "Mars/Olympus" }, {} as never, {} as never);
    expect(result.isError).toBe(true);
  });

  it("defaults to the server zone and stays a read", async () => {
    const tool = nowTool();
    expect(tool.gated).not.toBe(true);
    const result = await tool.execute({}, {} as never, {} as never);
    expect(result.isError).toBeUndefined();
  });
});
