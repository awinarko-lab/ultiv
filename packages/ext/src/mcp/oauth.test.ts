import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { startHttpFake, type HttpFake } from "./testing/http-fake.ts";
import { makeMcpConfigStore } from "./config.ts";
import { makeMcpManager } from "./manager.ts";
import { FAST_TUNING, makeRig, remoteInput, textOf, waitFor, type Rig } from "./testing/rig.ts";

const OWNER = "harry";
const CALLBACK = "https://box.tailnet.ts.net/api/mcp/oauth/callback";
let rig: Rig | undefined;
let fake: HttpFake | undefined;

afterEach(async () => {
  await rig?.close();
  await fake?.close();
  rig = undefined;
  fake = undefined;
});

/** The "user" approves at the fake AS; return the callback's code and state. */
const approveAt = async (url: string) => {
  const response = await fetch(url, { redirect: "manual" });
  const location = new URL(response.headers.get("location") ?? "");
  expect(`${location.origin}${location.pathname}`).toBe(CALLBACK);
  return {
    code: location.searchParams.get("code") ?? "",
    state: location.searchParams.get("state") ?? "",
  };
};

describe("MCP OAuth", () => {
  it("discovers, registers, signs in with PKCE, seals tokens, and refreshes", async () => {
    fake = await startHttpFake({ oauth: true });
    rig = makeRig();
    const { manager } = rig;
    const added = manager.add(OWNER, remoteInput(`${fake.base}/mcp`, { auth: { kind: "oauth" } }));
    await waitFor(manager, OWNER, added.id, "needs_sign_in");
    const url = await manager.signIn(OWNER, added.id, CALLBACK);
    expect(url).not.toBeNull();
    const authorize = new URL(url ?? "");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("resource")).toBe(`${fake.base}/mcp`);
    // The background connect may register once; Connect registers for its own callback.
    expect(fake.auth.counts.registrations).toBeGreaterThanOrEqual(1);
    const { code, state } = await approveAt(url ?? "");
    // A forged or replayed state is refused.
    await expect(manager.finishSignIn("forged", code)).rejects.toBeDefined();
    const info = await manager.finishSignIn(state, code);
    expect(info.signedIn).toBe(true);
    await expect(manager.finishSignIn(state, code)).rejects.toBeDefined();
    await waitFor(manager, OWNER, added.id, "connected");
    const who = textOf(await manager.call(OWNER, added.id, "whoami", {}, { timeoutMs: 5_000 }));
    const token = fake.auth.issued[0] ?? "missing";
    expect(who).toContain(token);
    expect(manager.scrub(OWNER, added.id, who)).not.toContain(token);
    // Tokens rest sealed: no file under the vault holds them in clear.
    const dir = join(rig.root, "vault", OWNER, "mcp-oauth");
    for (const file of readdirSync(dir)) {
      expect(readFileSync(join(dir, file), "utf8")).not.toContain(token);
    }
    // Expired access token: the SDK refreshes on reconnect.
    fake.auth.expireAll();
    await manager.reconnect(OWNER, added.id);
    await waitFor(manager, OWNER, added.id, "connected");
    expect(fake.auth.counts.refreshes).toBeGreaterThanOrEqual(1);
    // A restart (a fresh manager over the same dirs) reconnects signed in at boot.
    const again = makeMcpManager({
      config: makeMcpConfigStore(join(rig.root, "mcp")),
      vault: rig.vault,
      vaultRoot: join(rig.root, "vault"),
      tuning: FAST_TUNING,
    });
    again.boot();
    await waitFor(again, OWNER, added.id, "connected");
    await again.close();
    // Signing out drops the tokens.
    const out = await manager.signOut(OWNER, added.id);
    expect(out.signedIn).toBe(false);
  });

  it("signs in a CONFIDENTIAL client: vault-held secret, auth params, refresh", async () => {
    fake = await startHttpFake({
      oauth: true,
      // The token endpoint refuses any exchange without the secret.
      oauthRequireSecret: "gocsp-test-secret-0123456789",
    });
    rig = makeRig();
    const { manager, vault } = rig;
    const item = vault.create(OWNER, {
      kind: "key",
      name: "Google client secret",
      key: { secret: "gocsp-test-secret-0123456789" },
    });
    const added = manager.add(
      OWNER,
      remoteInput(`${fake.base}/mcp`, {
        auth: {
          kind: "oauth",
          clientId: "my-client-id.apps.googleusercontent.com",
          clientSecretItem: item.id,
          authParams: [{ name: "access_type", value: "offline" }],
        },
      }),
    );
    await waitFor(manager, OWNER, added.id, "needs_sign_in");
    const url = await manager.signIn(OWNER, added.id, CALLBACK);
    const authorize = new URL(url ?? "");
    expect(authorize.searchParams.get("client_id")).toBe("my-client-id.apps.googleusercontent.com");
    // Provider quirks (e.g. Google's offline access) ride the redirect.
    expect(authorize.searchParams.get("access_type")).toBe("offline");
    // No dynamic client registration for a pre-registered client.
    expect(fake.auth.counts.registrations).toBe(0);
    const { code, state } = await approveAt(url ?? "");
    const info = await manager.finishSignIn(state, code);
    expect(info.signedIn).toBe(true);
    await waitFor(manager, OWNER, added.id, "connected");
    // Refresh keeps authenticating with the secret (the fake enforces it).
    fake.auth.expireAll();
    await manager.reconnect(OWNER, added.id);
    await waitFor(manager, OWNER, added.id, "connected");
    expect(fake.auth.counts.refreshes).toBeGreaterThanOrEqual(1);
  });

  it("surfaces a broken client-secret vault item as a plain Connect error", async () => {
    fake = await startHttpFake({ oauth: true, oauthRequireSecret: "x".repeat(20) });
    rig = makeRig();
    const { manager } = rig;
    const added = manager.add(
      OWNER,
      remoteInput(`${fake.base}/mcp`, {
        auth: { kind: "oauth", clientId: "c", clientSecretItem: "gone-item" },
      }),
    );
    await waitFor(manager, OWNER, added.id, "failed");
    const cause = await manager.signIn(OWNER, added.id, CALLBACK).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect((cause as { reason?: string }).reason ?? "").toContain("the vault item is gone");
  });
});
