import { describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { openMind } from "../entity.ts";

/** Polls until the predicate holds or the budget runs out (offline settles are async). */
const until = async <T>(probe: () => Promise<T>, ready: (value: T) => boolean): Promise<T> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await probe();
    if (ready(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for the task to settle");
};

describe("Tasks (offline, MemoryStorage)", () => {
  it("spawns a background task and settles it as failed without a provider", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const spawned = await Effect.runPromise(
      handle.mind.tasks.spawn({
        sessionId: "session-1",
        owner: "guest",
        prompt: "do the thing",
      }),
    );
    expect(spawned.status).toBe("running");
    const settled = await until(
      () => Effect.runPromise(handle.mind.tasks.get(spawned.id)).then((task) => task ?? null),
      (task) => task !== null && task.finishedAt !== null,
    );
    // Offline there is no provider, so the turn fails loudly — the task says so.
    expect(settled?.status).toBe("failed");
    expect(settled?.error ?? "").not.toBe("");
    const list = await Effect.runPromise(handle.mind.tasks.list());
    expect(list.map((task) => task.id)).toContain(spawned.id);
    await handle.close();
  });
});
