import { describe, expect, it } from "vite-plus/test";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { openMind } from "../entity.ts";

describe("Memory seam (offline, MemoryStorage)", () => {
  it("scopes profile memory, gates owner memory to the keeper", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { memory, profiles } = handle.mind;
    const keeper = await profiles.create("harry", {
      name: "Note Taker",
      policies: {
        canInitiate: [],
        autoApprove: [],
        approvalTimeout: "deny",
        dailyTurnBudget: null,
        memoryKeeper: true,
      },
    });
    const worker = await profiles.create("harry", { name: "Researcher" });

    await memory.write({
      owner: "harry",
      writer: worker.id,
      scope: "profile",
      profileId: worker.id,
      text: "prefers typescript",
    });
    await memory.write({
      owner: "harry",
      writer: keeper.id,
      scope: "owner",
      text: "harry wakes at 5am",
    });

    let refused = false;
    try {
      await memory.write({ owner: "harry", writer: worker.id, scope: "owner", text: "nope" });
    } catch (cause) {
      refused = (cause as { reason?: string }).reason?.includes("keeper") === true;
    }
    expect(refused).toBe(true);

    // An entity recalls its own memory plus the owner store.
    const recalled = await memory.recallFor("harry", worker.id, "typescript");
    expect(recalled.length).toBe(1);
    const ownerFacts = await memory.recallFor("harry", worker.id, "5am");
    expect(ownerFacts.length).toBe(1);
    await handle.close();
  });

  it("purges a profile's memory with the profile", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { memory, profiles } = handle.mind;
    const gone = await profiles.create("harry", { name: "Temp" });
    await memory.write({
      owner: "harry",
      writer: gone.id,
      scope: "profile",
      profileId: gone.id,
      text: "fact",
    });
    expect(await memory.removeProfile("harry", gone.id)).toBe(1);
    expect(await memory.recallFor("harry", gone.id, "fact")).toEqual([]);
    await handle.close();
  });
});
