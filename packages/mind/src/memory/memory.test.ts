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

  it("migrates a v1 store lazily and mirrors v2 writes back to v1", async () => {
    process.env.ULTIV_MEMORY_V2 = "off";
    const handle = await openMind({ storage: new MemoryStorage() });
    const { memory, profiles } = handle.mind;
    const bot = await profiles.create("harry", { name: "Migrator" });
    await memory.write({
      owner: "harry",
      writer: bot.id,
      scope: "profile",
      profileId: bot.id,
      text: "legacy fact",
      tags: ["old"],
    });
    // First v2 access migrates in place; ids, text and tags survive.
    process.env.ULTIV_MEMORY_V2 = "on";
    const facts = await memory.readFacts("harry", bot.id);
    expect(facts.length).toBe(1);
    expect(facts[0]?.text).toBe("legacy fact");
    expect(facts[0]?.importance).toBe(3);
    expect(facts[0]?.status).toBe("current");
    expect(facts[0]?.trust).toBe("self");
    // Idempotent: a second read neither duplicates nor re-stamps.
    expect((await memory.readFacts("harry", bot.id)).length).toBe(1);
    // A v2 write also lands in the v1 mirror while MEMORY_V1_MIRROR is on.
    await memory.write({
      owner: "harry",
      writer: bot.id,
      scope: "profile",
      profileId: bot.id,
      text: "fresh fact",
    });
    const v1 = await memory.read("harry", "profile", bot.id);
    expect(v1.map((record) => record.text).sort()).toEqual(["fresh fact", "legacy fact"]);
    delete process.env.ULTIV_MEMORY_V2;
    await handle.close();
  });

  it("consolidates v2 writes: dedupe, supersede with history, mirror", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { memory, profiles } = handle.mind;
    const bot = await profiles.create("harry", { name: "Consolidator" });
    const first = await memory.writeV2({
      owner: "harry",
      profileId: bot.id,
      scope: "profile",
      writer: bot.id,
      text: "harry lives in bandung",
      tags: ["home"],
    });
    expect(first.op).toBe("add");
    // A reworded duplicate collapses onto the existing fact (noop).
    const dup = await memory.writeV2({
      owner: "harry",
      profileId: bot.id,
      scope: "profile",
      writer: bot.id,
      text: "Harry lives in Bandung!",
    });
    expect(dup.op).toBe("noop");
    expect(dup.id).toBe(first.id);
    // An explicit correction supersedes; the old version stays as history.
    const moved = await memory.writeV2({
      owner: "harry",
      profileId: bot.id,
      scope: "profile",
      writer: bot.id,
      text: "harry moved to surabaya last month",
      replaces: first.id,
    });
    expect(moved.op).toBe("supersede");
    expect(moved.replaced).toBe(first.id);
    const facts = await memory.readFacts("harry", bot.id);
    expect(facts.length).toBe(2);
    const old = facts.find((fact) => fact.id === first.id);
    expect(old?.status).toBe("superseded");
    expect(old?.supersededBy).toBe(moved.id);
    // The mirror saw both new facts.
    const v1 = await memory.read("harry", "profile", bot.id);
    expect(v1.length).toBe(2);
    await handle.close();
  });
});
