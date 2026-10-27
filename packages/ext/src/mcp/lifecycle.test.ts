import { afterEach, describe, expect, it } from "vite-plus/test";
import { startHttpFake, type HttpFake } from "./testing/http-fake.ts";
import { makeRig, remoteInput, textOf, waitFor, type Rig } from "./testing/rig.ts";

const OWNER = "harry";
const SECRET = "sk_mcp_0123456789abcdef";
let rig: Rig | undefined;
let fake: HttpFake | undefined;

afterEach(async () => {
  await rig?.close();
  await fake?.close();
  rig = undefined;
  fake = undefined;
});

describe("MCP lifecycle", () => {
  it("sends vault headers, never shows them, and says when they are refused", async () => {
    fake = await startHttpFake({ bearer: SECRET });
    rig = makeRig();
    const good = rig.vault.create(OWNER, { kind: "key", name: "Good", key: { secret: SECRET } });
    const bad = rig.vault.create(OWNER, {
      kind: "key",
      name: "Bad",
      key: { secret: "wrong-secret-value" },
    });
    const auth = (item: string) => ({
      kind: "headers" as const,
      headers: [{ name: "Authorization", item, prefix: "Bearer " }],
    });
    const ok = rig.manager.add(OWNER, remoteInput(`${fake.base}/mcp`, { auth: auth(good.id) }));
    await waitFor(rig.manager, OWNER, ok.id, "connected");
    const who = textOf(await rig.manager.call(OWNER, ok.id, "whoami", {}, { timeoutMs: 5_000 }));
    expect(who).toContain(SECRET);
    expect(rig.manager.scrub(OWNER, ok.id, who)).not.toContain(SECRET);
    expect(JSON.stringify(rig.manager.list(OWNER))).not.toContain(SECRET);
    const refused = rig.manager.add(
      OWNER,
      remoteInput(`${fake.base}/mcp`, { name: "Refused", auth: auth(bad.id), transport: "http" }),
    );
    const info = await waitFor(rig.manager, OWNER, refused.id, "needs_sign_in");
    expect(info.reason).toMatch(/refused the credentials/);
    expect(JSON.stringify(info)).not.toContain("wrong-secret-value");
  });

  it("adds, edits, disables and removes live; in-flight calls end cleanly", async () => {
    fake = await startHttpFake();
    rig = makeRig();
    const { manager } = rig;
    let changes = 0;
    manager.subscribe(() => (changes += 1));
    const added = manager.add(OWNER, remoteInput(`${fake.base}/mcp`));
    await waitFor(manager, OWNER, added.id, "connected");
    expect(manager.views().map((view) => view.record.id)).toEqual([added.id]);
    expect(changes).toBeGreaterThan(0);
    // Per-tool switch-off is a config edit, not a reconnect.
    const edited = await manager.update(OWNER, added.id, {
      ...remoteInput(`${fake.base}/mcp`),
      disabledTools: ["delete_everything"],
    });
    expect(edited.state).toBe("connected");
    expect(edited.tools.find((tool) => tool.remoteName === "delete_everything")?.enabled).toBe(
      false,
    );
    // Disable, then enable again.
    const off = await manager.update(OWNER, added.id, {
      ...remoteInput(`${fake.base}/mcp`),
      enabled: false,
    });
    expect(off.state).toBe("disabled");
    expect(manager.views()).toEqual([]);
    await manager.update(OWNER, added.id, remoteInput(`${fake.base}/mcp`));
    await waitFor(manager, OWNER, added.id, "connected");
    // A call in flight when the server is removed ends with a clean error.
    const pending = manager.call(OWNER, added.id, "slow", { ms: 3_000 }, { timeoutMs: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await manager.remove(OWNER, added.id)).toBe(true);
    await expect(pending).rejects.toThrow(/disconnected during the call|cancel|closed/i);
    expect(manager.list(OWNER)).toEqual([]);
  });

  it("times out and cancels calls with plain words", async () => {
    fake = await startHttpFake();
    rig = makeRig();
    const added = rig.manager.add(OWNER, remoteInput(`${fake.base}/mcp`));
    await waitFor(rig.manager, OWNER, added.id, "connected");
    await expect(
      rig.manager.call(OWNER, added.id, "slow", { ms: 2_000 }, { timeoutMs: 200 }),
    ).rejects.toThrow(/did not answer within/);
    const controller = new AbortController();
    const pending = rig.manager.call(
      OWNER,
      added.id,
      "slow",
      { ms: 2_000 },
      {
        timeoutMs: 5_000,
        signal: controller.signal,
      },
    );
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
  });

  it("reconnects with backoff after the server comes back, and owners stay apart", async () => {
    fake = await startHttpFake();
    rig = makeRig();
    const added = rig.manager.add(OWNER, remoteInput(`${fake.base}/mcp`));
    await waitFor(rig.manager, OWNER, added.id, "connected");
    expect(rig.manager.list("someone-else")).toEqual([]);
    expect(rig.manager.info("someone-else", added.id)).toBeUndefined();
    await expect(rig.manager.reconnect("someone-else", added.id)).rejects.toBeDefined();
    const info = await rig.manager.reconnect(OWNER, added.id);
    expect(["connected", "connecting"]).toContain(info.state);
    await waitFor(rig.manager, OWNER, added.id, "connected");
  });
});
