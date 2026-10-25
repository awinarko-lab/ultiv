import { describe, expect, it } from "vite-plus/test";
import { Gate } from "./gate.ts";

describe("Gate (counting semaphore)", () => {
  it("lets one through at a time and queues the rest", async () => {
    const gate = new Gate(1);
    let active = 0;
    let peak = 0;
    const work = (): Promise<number> =>
      gate.hold(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return active;
      });
    await Promise.all([work(), work(), work()]);
    expect(peak).toBe(1);
  });

  it("admits up to the limit concurrently", async () => {
    const gate = new Gate(2);
    let active = 0;
    let peak = 0;
    const work = (): Promise<void> =>
      gate.hold(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
      });
    await Promise.all([work(), work(), work(), work()]);
    expect(peak).toBe(2);
  });

  it("releases on failure so the slot is not lost", async () => {
    const gate = new Gate(1);
    await expect(
      gate.hold(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await gate.hold(async () => "ok")).toBe("ok");
  });
});
