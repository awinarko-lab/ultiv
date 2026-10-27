import { describe, expect, it } from "vite-plus/test";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { openMind } from "../entity.ts";
import { renderCore } from "../profiles/section.ts";
import { CORE_LIMITS } from "./core.ts";

describe("core memory", () => {
  it("adds, budgets, protects pinned lines and reports words left", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { memory, profiles } = handle.mind;
    const bot = await profiles.create("harry", {
      name: "Core Bot",
      policies: {
        canInitiate: [],
        autoApprove: [],
        approvalTimeout: "deny",
        dailyTurnBudget: null,
        memoryKeeper: true,
      },
    });
    // Bots write their own core; owner core is keeper-only.
    const line = await memory.core.add({
      owner: "harry",
      profileId: bot.id,
      scope: "profile",
      writer: bot.id,
      text: "Responds in Indonesian unless asked otherwise.",
    });
    expect(line.pinned).toBe(false);
    let refused = "";
    try {
      await memory.core.add({
        owner: "harry",
        profileId: bot.id,
        scope: "profile",
        writer: bot.id,
        text: "Over the line limit here ".repeat(6),
      });
    } catch (cause) {
      refused = (cause as { reason?: string }).reason ?? "";
    }
    expect(refused).toContain("25 words");
    try {
      await memory.core.add({
        owner: "harry",
        profileId: null,
        scope: "owner",
        writer: bot.id,
        text: "owner core from the keeper bot",
      });
      refused = "";
    } catch (cause) {
      refused = (cause as { reason?: string }).reason ?? "";
    }
    // The keeper writes owner core fine.
    expect(refused).toBe("");
    // Pin (owner/Human only) and then refuse the bot.
    const pinned = await memory.core.add({
      owner: "harry",
      profileId: null,
      scope: "owner",
      writer: null,
      text: "Harry's cats: Oren and Putih.",
      pinned: true,
    });
    try {
      await memory.core.replace({
        owner: "harry",
        profileId: null,
        writer: bot.id,
        lineId: pinned.id,
        text: "nope",
      });
    } catch (cause) {
      refused = (cause as { reason?: string }).reason ?? "";
    }
    expect(refused).toContain("pinned");
    const lines = await memory.core.read("harry", bot.id);
    expect(lines.some((entry) => entry.id === line.id)).toBe(true);
    await handle.close();
  });

  it("renders the section under the 230-word budget", () => {
    const long = Array.from({ length: 12 }, (_, i) => ({
      id: `l${i}`,
      text: `line ${i} ${"word ".repeat(25)}`,
      factId: null,
      pinned: false,
      at: 0,
    }));
    const rendered = renderCore(long);
    const words = rendered.trim().split(/\s+/).filter(Boolean).length;
    expect(words).toBeLessThanOrEqual(CORE_LIMITS.renderWords + 12);
    expect(renderCore([])).toBe("");
  });
});
