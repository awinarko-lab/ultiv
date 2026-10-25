import { describe, expect, it } from "vite-plus/test";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { Effect } from "effect";
import { openMind } from "../entity.ts";

describe("Profiles (offline, MemoryStorage)", () => {
  it("materializes a default profile per owner and scopes sessions to profiles", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { profiles } = handle.mind;
    const mine = await profiles.list("harry");
    expect(mine.length).toBe(1);
    expect(mine[0]?.id).toBe("default");

    const created = await profiles.createSession("harry", "default", "work");
    const listed = await profiles.listSessions("harry");
    expect(listed.filter((row) => row.id === created.id).length).toBe(1);
    expect((await profiles.listSessions("someone-else")).length).toBe(0);
    await handle.close();
  });

  it("creates profiles, Bot Mode main chats, and maps conversations to the profile", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { profiles } = handle.mind;
    const researcher = await profiles.create("harry", {
      name: "Researcher",
      description: "Deep-dive analysis",
      persona: "You are meticulous.",
    });
    expect(researcher.timezone.length).toBeGreaterThan(0);

    const main = await profiles.ensureMain("harry", researcher.id);
    expect(main.kind).toBe("main");
    // Idempotent: the same row comes back.
    expect((await profiles.ensureMain("harry", researcher.id)).id).toBe(main.id);
    // The main chat's conversation maps back to the profile (persona/audit scope).
    const scoped = await Effect.runPromise(
      handle.mind.converse.conversationIdOf(await profiles.keyOfRow(main)),
    );
    expect(scoped).toBeDefined();
    expect(profiles.profileOf(String(scoped))?.id).toBe(researcher.id);
    expect(profiles.scopeOf(String(scoped))?.kind).toBe("main");
    await handle.close();
  });

  it("reset rotates the main chat and keeps the old transcript listed", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { profiles } = handle.mind;
    const first = await profiles.ensureMain("harry", "default");
    const second = await profiles.resetMain("harry", "default");
    expect(second.id).not.toBe(first.id);
    expect(second.kind).toBe("main");
    const rows = await profiles.listSessions("harry");
    const old = rows.find((row) => row.id === first.id);
    expect(old?.kind).toBe("session");
    await handle.close();
  });

  it("rooms are contextual: one per pair+topic, and never sessions", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { profiles, rooms } = handle.mind;
    const a = await profiles.create("harry", { name: "CoS", onboard: false });
    const b = await profiles.create("harry", { name: "Researcher", onboard: false });
    const report = await rooms.ensure("harry", [a.id, b.id], "Q3 report");
    // Same participants + topic → the same room; different topic → a new one.
    expect((await rooms.ensure("harry", [b.id, a.id], "Q3 report")).id).toBe(report.id);
    const onboard = await rooms.ensure("harry", [a.id, b.id], "onboarding");
    expect(onboard.id).not.toBe(report.id);
    // Rooms are invisible in session lists (bot-to-bot traffic is not "my chats").
    expect((await profiles.listSessions("harry")).every((row) => row.kind !== "room")).toBe(true);
    // Each participant's seat is scoped to THEIR profile — identity and memory
    // are per-entity, never shared.
    for (const seat of await rooms.seats("harry", report)) {
      const scope = handle.mind.profiles.scopeOf(seat.conversationId ?? "");
      expect(scope?.kind).toBe("room");
      expect(scope?.participants).toContain(a.id);
      expect(scope?.participants).toContain(b.id);
    }
    expect(await rooms.purgeProfile("harry", a.id)).toBe(2);
    expect((await rooms.list("harry")).length).toBe(0);
    await handle.close();
  });

  it("rejects bad input and removes profiles with their sessions", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { profiles } = handle.mind;
    let threw = false;
    try {
      await profiles.create("harry", { name: "X", timezone: "Mars/Olympus" });
    } catch (error) {
      threw = (error as { reason?: string }).reason === "unknown timezone: Mars/Olympus";
    }
    expect(threw).toBe(true);
    const profile = await profiles.create("harry", { name: "Temp", onboard: false });
    await profiles.createSession("harry", profile.id, null);
    const removed = await profiles.remove("harry", profile.id);
    expect(removed.length).toBe(1);
    expect((await profiles.listSessions("harry", profile.id)).length).toBe(0);
    expect(await profiles.get("harry", profile.id)).toBeUndefined();
    await handle.close();
  });

  it("applies tool allowlists to the agent new conversations start with", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { profiles } = handle.mind;
    const profile = await profiles.create("harry", {
      name: "Locked",
      toolAllowlist: ["now", "web_search"],
    });
    const agent = profiles.agentFor(profile);
    expect(Array.isArray(agent.tools)).toBe(true);
    const names = (agent.tools as readonly { name: string }[]).map((tool) => tool.name);
    expect(names).toEqual(["now", "web_search"]);
    // No allowlist: all tools stay available.
    const open = profiles.agentFor(await profiles.ensureDefault("harry"));
    expect(open.tools).toBeUndefined();
    await handle.close();
  });
});
