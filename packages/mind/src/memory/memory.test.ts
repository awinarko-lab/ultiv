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
        approvalMode: "manual",
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

  it("has no v1 migration: v2 reads return empty stores, the projection holds", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { memory, profiles } = handle.mind;
    const bot = await profiles.create("harry", { name: "Fresh" });
    // No migration pass exists anymore: an untouched store reads empty.
    expect(await memory.readFacts("harry", bot.id)).toEqual([]);
    expect(await memory.readFacts("harry", null)).toEqual([]);
    // A profile read without a profile id reads NOTHING (never a
    // store keyed with an empty id).
    expect(await memory.read("harry", "profile")).toEqual([]);
    await memory.write({
      owner: "harry",
      writer: bot.id,
      scope: "profile",
      profileId: bot.id,
      text: "fresh fact",
    });
    const projected = await memory.read("harry", "profile", bot.id);
    expect(projected.map((record) => record.text)).toEqual(["fresh fact"]);
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
    // The mirror is gone: `read` projects the v2 store (newest first).
    const projected = await memory.read("harry", "profile", bot.id);
    expect(projected.map((record) => record.text)).toEqual([
      "harry moved to surabaya last month",
      "harry lives in bandung",
    ]);
    await handle.close();
  });

  it("ranks own + owner recall in ONE merged list (limit and budget hold)", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { memory, profiles } = handle.mind;
    const keeper = await profiles.create("harry", {
      name: "Keeper",
      policies: {
        canInitiate: [],
        autoApprove: [],
        approvalMode: "manual",
        approvalTimeout: "deny",
        dailyTurnBudget: null,
        memoryKeeper: true,
      },
    });
    const bot = await profiles.create("harry", { name: "Researcher" });
    // Owner-store fact: the strongest match for the query below.
    await memory.write({
      owner: "harry",
      writer: keeper.id,
      scope: "owner",
      text: "kucing oren tidur siang di sofa every day",
    });
    // Profile facts also matching, so the old concatenate-then-slice would
    // fill the limit with profile rows alone.
    for (const text of [
      "kucing oren makan pagi",
      "kucing oren main malam",
      "kucing tetangga hitam",
    ]) {
      await memory.writeV2({
        owner: "harry",
        profileId: bot.id,
        scope: "profile",
        writer: bot.id,
        text,
      });
    }
    const ranked = await memory.recallV2("harry", bot.id, {
      query: "kucing oren tidur",
      limit: 2,
      budgetTokens: 300,
    });
    expect(ranked.facts.length).toBeLessThanOrEqual(2);
    expect(ranked.tokens).toBeLessThanOrEqual(300);
    expect(ranked.facts[0]?.scope).toBe("owner");
    await handle.close();
  });
});
