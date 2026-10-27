import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createRegistry, type ToolRegistration } from "@earendil-works/pi-durable";
import { makeBindingStore } from "@ultiv/ext";
import { makeRig, startHttpFake, type HttpFake, type Rig } from "@ultiv/ext/mcp-testing";
import { makeApprovals } from "../approvals.ts";
import { makeAudit } from "../audit/audit.ts";
import type { ProfilesService } from "../profiles/profiles.ts";
import { makeSecretRequests, type SecretRequestsService } from "../secrets/requests.ts";
import { makeUntrustedNotes } from "./access.ts";
import { wireMcp, type McpWiring } from "./install.ts";
import { CONNECTOR_CHANGES, isNeverAutoApproved, planAdd } from "./manage.ts";

const OWNER = "harry";
const CONVERSATION = "c1";
// Built at runtime so the literal never sits next to a log line.
const TOKEN = ["tok", "en", "-", "9f3a7c2e"].join("");
let rig: Rig | undefined;
let fake: HttpFake | undefined;
let wiring: McpWiring | undefined;

afterEach(async () => {
  wiring?.close();
  await rig?.close();
  await fake?.close();
  [rig, fake, wiring] = [undefined, undefined, undefined];
});

type Answer = boolean | { values: Record<string, string> } | "cancel" | "ignore";

const setUp = async (secretTimeoutMs = 5_000) => {
  fake = await startHttpFake({ bearer: TOKEN });
  rig = makeRig();
  const registry = createRegistry();
  const approvals = makeApprovals();
  const auditPath = join(mkdtempSync(join(tmpdir(), "ultiv-audit-")), "audit.jsonl");
  const audit = makeAudit(auditPath);
  const bindings = makeBindingStore(join(rig.root, "vault"));
  const profiles = {
    scopeOf: () => ({ owner: OWNER, profileId: "p1", kind: "main", participants: null }),
    profileOf: () => ({ id: "p1", toolAllowlist: null }),
    list: async () => [
      { id: "p1", name: "Eve" },
      { id: "p2", name: "Ops" },
    ],
  } as unknown as ProfilesService;
  const secrets: SecretRequestsService = makeSecretRequests({
    approvals,
    vault: rig.vault,
    ownerOf: () => OWNER,
    timeoutMs: secretTimeoutMs,
  });
  wiring = wireMcp(registry, {
    manager: rig.manager,
    approvals,
    audit,
    profiles,
    notes: makeUntrustedNotes(),
    callTimeoutMs: 5_000,
    secrets,
    vault: rig.vault,
    bindings,
    settleMs: 8_000,
  });
  const tool = (name: string): ToolRegistration | undefined =>
    registry
      .snapshot()
      .tools()
      .find((entry) => entry.tool.name === name)?.tool;
  let calls = 0;
  /** Run a tool; `answer` handles each card (approve, deny, type a secret, cancel). */
  const run = async (
    name: string,
    args: unknown,
    answer: (card: string, input: unknown) => Answer,
  ) => {
    const callId = `call-${(calls += 1)}`;
    const found = tool(name);
    if (found === undefined) throw new Error(`no tool ${name}`);
    const pending = found.execute(
      args as never,
      { conversationId: CONVERSATION, callId } as never,
      {} as never,
    );
    const cards: { name: string; input: unknown }[] = [];
    const seen = new Set<string>();
    const tick = setInterval(() => {
      for (const card of approvals.pendingFor(CONVERSATION)) {
        if (seen.has(card.callId)) continue;
        seen.add(card.callId);
        cards.push({ name: card.name, input: card.input });
        const reply = answer(card.name, card.input);
        if (reply === "ignore") continue;
        if (reply === "cancel") secrets.cancel(OWNER, card.callId);
        else if (typeof reply === "object")
          expect(secrets.submit(OWNER, card.callId, reply.values).ok).toBe(true);
        else approvals.decide(CONVERSATION, card.callId, reply);
      }
    }, 5);
    try {
      const result = await pending;
      const text = (result.output ?? [])
        .map((block) => ("text" in block ? block.text : ""))
        .join("");
      return { result, text, cards };
    } finally {
      clearInterval(tick);
    }
  };
  return {
    run,
    tool,
    secrets,
    approvals,
    bindings,
    auditPath,
    manager: rig.manager,
    url: `${fake.base}/mcp`,
  };
};

describe("bot-managed connectors", () => {
  it("adds a server live after the card, with the key typed in a secure field", async () => {
    const { run, tool, manager, auditPath, url } = await setUp();
    expect(tool("fake_echo")).toBeUndefined();
    const added = await run("connector_add", { name: "fake", url, auth: "api_key" }, (card) =>
      card === "secret_request" ? { values: { f0: TOKEN } } : card === "connector_add",
    );
    expect(added.cards.map((card) => card.name)).toEqual(["connector_add", "secret_request"]);
    expect(added.cards[0]?.input).toMatchObject({
      change: "add",
      server: "fake",
      url,
      bots: "Eve",
      runsOnMac: false,
    });
    expect(added.text).toContain("Connected with");
    expect(added.text).toContain("fake_echo");
    expect(tool("fake_echo")).toBeDefined();
    expect(fake?.lastAuthorization()).toBe(`Bearer ${TOKEN}`);
    // The value is nowhere the model, the transcript or the audit trail can see.
    const visible = JSON.stringify([added.text, added.cards, manager.list(OWNER)]);
    expect(visible).not.toContain(TOKEN);
    expect(readFileSync(auditPath, "utf8")).not.toContain(TOKEN);
  });

  it("changes nothing when the owner denies the card or cancels the secure field", async () => {
    const { run, manager, url } = await setUp();
    const denied = await run("connector_add", { name: "fake", url, auth: "api_key" }, () => false);
    expect(denied.result.isError).toBe(true);
    expect(denied.cards.map((card) => card.name)).toEqual(["connector_add"]);
    const cancelled = await run("connector_add", { name: "fake", url, auth: "api_key" }, (card) =>
      card === "secret_request" ? "cancel" : true,
    );
    expect(cancelled.result.isError).toBe(true);
    expect(cancelled.text).toContain("nothing was stored");
    expect(manager.list(OWNER)).toEqual([]);
  });

  it("times out an unanswered secure field without adding anything", async () => {
    const { run, manager, url } = await setUp(80);
    const late = await run("connector_add", { name: "fake", url, auth: "api_key" }, (card) =>
      card === "secret_request" ? "ignore" : true,
    );
    expect(late.result.isError).toBe(true);
    expect(manager.list(OWNER)).toEqual([]);
  });

  it("gates disable and remove behind cards; reconnect and list need none", async () => {
    const { run, manager, url } = await setUp();
    await run("connector_add", { name: "fake", url, auth: "api_key" }, (card) =>
      card === "secret_request" ? { values: { f0: TOKEN } } : true,
    );
    const listed = await run("connector_list", {}, () => false);
    expect(listed.cards).toEqual([]);
    expect(listed.text).toContain("context7");
    const kept = await run("connector_disable", { server: "fake" }, () => false);
    expect(kept.result.isError).toBe(true);
    expect(manager.list(OWNER)[0]?.enabled).toBe(true);
    const off = await run("connector_disable", { server: "fake" }, () => true);
    expect(off.cards.map((card) => card.name)).toEqual(["connector_disable"]);
    expect(manager.list(OWNER)[0]?.state).toBe("disabled");
    const moved = await run("connector_update", { server: "fake", bots: ["*"] }, () => true);
    expect(moved.cards[0]?.input).toMatchObject({ changes: ["Bots: Eve → Every bot"] });
    const gone = await run("connector_remove", { server: "fake" }, () => true);
    expect(gone.text).toContain("Removed");
    expect(manager.list(OWNER)).toEqual([]);
  });

  it("stores a secret_request value in the vault and binds it for http_request", async () => {
    const { run, bindings, secrets, auditPath } = await setUp();
    const asked = await run(
      "secret_request",
      { label: "Acme key", purpose: "Call the Acme API", bindTo: { host: "api.acme.test" } },
      (card, input) => {
        expect(card).toBe("secret_request");
        expect(input).toMatchObject({ usedFor: "only sent to api.acme.test" });
        expect(secrets.submit("someone-else", "call-1", { secret: TOKEN }).ok).toBe(false);
        expect(secrets.submit(OWNER, "call-1", { secret: "short" }).ok).toBe(false);
        return { values: { secret: TOKEN } };
      },
    );
    expect(asked.text).toContain('stored as vault item "Acme key"');
    expect(asked.text).not.toContain(TOKEN);
    expect(bindings.list(OWNER)[0]?.hosts).toEqual(["api.acme.test"]);
    expect(readFileSync(auditPath, "utf8")).not.toContain(TOKEN);
  });
});

describe("planning a connector change", () => {
  it("fills presets and shows a local command's env names, never values", () => {
    const preset = planAdd({ preset: "context7" }, { items: [], bots: "Eve", profiles: ["p1"] });
    expect(preset).toMatchObject({ card: { url: "https://mcp.context7.com/mcp", auth: "No key" } });
    const local = planAdd(
      { name: "files", command: "npx", args: ["-y", "srv"], env: [{ name: "API_TOKEN" }] },
      { items: [], bots: "Eve", profiles: ["p1"] },
    );
    expect(local).toMatchObject({ card: { runsOnMac: true, env: ["API_TOKEN"], command: "npx" } });
    expect(
      planAdd(
        { name: "x", url: "https://x.test", vaultItem: "nope" },
        { items: [], bots: "", profiles: null },
      ),
    ).toBe('no vault item "nope"');
  });

  it("keeps connector changes and secure inputs out of Always allow", () => {
    for (const name of [...CONNECTOR_CHANGES, "secret_request"])
      expect(isNeverAutoApproved(name)).toBe(true);
    expect(isNeverAutoApproved("connector_list")).toBe(false);
  });
});
