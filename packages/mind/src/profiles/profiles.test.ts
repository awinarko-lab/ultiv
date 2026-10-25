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

  it("creates one DM thread per pair, shared by both directions", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { profiles } = handle.mind;
    const a = await profiles.create("harry", { name: "CoS" });
    const b = await profiles.create("harry", { name: "Researcher" });
    const dm1 = await profiles.ensureDm("harry", a.id, b.id);
    const dm2 = await profiles.ensureDm("harry", b.id, a.id);
    expect(dm1.id).toBe(dm2.id);
    expect(dm1.participants).toContain(a.id);
    // The DM shows under both participants' session lists.
    expect((await profiles.listSessions("harry", a.id)).some((row) => row.id === dm1.id)).toBe(
      true,
    );
    expect((await profiles.listSessions("harry", b.id)).some((row) => row.id === dm1.id)).toBe(
      true,
    );
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
    const profile = await profiles.create("harry", { name: "Temp" });
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
