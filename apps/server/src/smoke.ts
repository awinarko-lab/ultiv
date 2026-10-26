// Boots the full server stack on an ephemeral port, exercises the REST
// surface, and closes it cleanly — all offline and ephemeral (MemoryStorage).
// Run: vpr smoke  (root), or vp run --filter @ultiv/server smoke
import { MemoryStorage } from "@earendil-works/pi-durable";
import { Session } from "@ultiv/contracts";
import { buildStack } from "./main.ts";

// The vault seals under this key for the smoke run only; the vault and the
// artifact workspace point at throwaway dirs so the run is hermetic.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.VAULT_KEY = "smoke-vault-key";
const scratchVault = mkdtempSync(join(tmpdir(), "ultiv-smoke-vault-"));
const scratchArtifacts = mkdtempSync(join(tmpdir(), "ultiv-smoke-artifacts-"));
process.env.ARTIFACTS_DIR = scratchArtifacts;
// Keep the audit trail hermetic: never append to a real var/audit.jsonl.
process.env.AUDIT_LOG = join(scratchArtifacts, "audit.jsonl");

const stack = await buildStack({ storage: new MemoryStorage(), vault: { dir: scratchVault } });
await new Promise<void>((resolve, reject) => {
  stack.http.once("listening", resolve);
  stack.http.once("error", reject);
  stack.http.listen(0, "127.0.0.1");
});
// The Session object must activate offline: its harness conversation is created lazily on first input.
const session = await stack.host.get(Session, { id: "smoke" });
session.release();

const address = stack.http.address();
const port = typeof address === "object" && address !== null ? address.port : address;
const base = `http://127.0.0.1:${port}`;
const call = async (
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any }> => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return {
    status: response.status,
    json: (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })(),
  };
};

// REST surface: owner scoping, artifacts, webhook auth, cron validation.
const failures: string[] = [];
const expect = (name: string, ok: boolean): void => {
  if (!ok) failures.push(name);
};

const created = await call("POST", "/api/sessions", { title: "s" }, { "x-ultiv-user": "smoker" });
expect("session create", created.status === 200 && created.json.owner === "smoker");
const mine = await call("GET", "/api/sessions", undefined, { "x-ultiv-user": "smoker" });
const others = await call("GET", "/api/sessions", undefined, { "x-ultiv-user": "someone-else" });
expect("owner scoping", mine.json.length === 1 && others.json.length === 0);

const upload = await fetch(`${base}/api/artifacts?name=smoke.md`, { method: "POST", body: "# ok" });
const artifact = (await upload.json()) as { id: string; mime: string };
expect("artifact upload", upload.status === 200 && artifact.mime === "text/markdown");
const raw = await fetch(`${base}/api/artifacts/${artifact.id}`);
expect("artifact download", raw.status === 200 && (await raw.text()) === "# ok");

const hook = await call("POST", "/api/webhooks", { sessionId: created.json.id });
expect(
  "webhook create + auth",
  hook.status === 200 && (await call("POST", `/hooks/${hook.json.id}?token=x`, "b")).status === 404,
);

const badCron = await call("POST", "/api/cron", { sessionId: "s", schedule: "nope", prompt: "x" });
expect("cron rejects bad schedule", badCron.status === 400);
const cron = await call("POST", "/api/cron", {
  sessionId: created.json.id,
  schedule: "*/5 * * * *",
  prompt: "tick",
});
expect(
  "cron create + delete",
  cron.status === 200 && (await call("DELETE", `/api/cron/${cron.json.id}`)).json.ok === true,
);

const task = await call("POST", "/api/tasks", { prompt: "background check" });
expect("task spawn", task.status === 200 && task.json.status === "running");
const audit = await call("GET", "/api/audit");
expect("audit tail", audit.status === 200 && Array.isArray(audit.json));

// Profiles: CRUD, Bot Mode, per-profile sessions and artifacts.
const headers = { "x-ultiv-user": "smoker" };
const profilesListed = await call("GET", "/api/profiles", undefined, headers);
expect(
  "profiles list materializes default",
  profilesListed.status === 200 &&
    profilesListed.json.some((p: { id: string }) => p.id === "default"),
);
const researcher = await call(
  "POST",
  "/api/profiles",
  { name: "Researcher", persona: "Careful." },
  headers,
);
expect("profile create", researcher.status === 200 && researcher.json.owner === "smoker");
const rid = researcher.json.id as string;
const patched = await call("PATCH", `/api/profiles/${rid}`, { description: "deep dives" }, headers);
expect("profile patch", patched.status === 200 && patched.json.description === "deep dives");
// Per-bot model preference: durable on the profile, and applied to the bot's
// existing conversations (configure, not prompt-hacking).
const modelPatched = await call(
  "PATCH",
  `/api/profiles/${rid}`,
  { model: { id: "glm-5-3-flash", effort: "high" } },
  headers,
);
expect(
  "bot model preference sticks",
  modelPatched.status === 200 &&
    modelPatched.json.model?.id === "glm-5-3-flash" &&
    modelPatched.json.model?.effort === "high",
);
const mainAgain = await call("GET", `/api/profiles/${rid}/main`, undefined, headers);
const mainConv = await call("GET", `/api/sessions?profile=${rid}`, undefined, headers);
expect(
  "bot sessions still listed after model patch",
  mainAgain.status === 200 && Array.isArray(mainConv.json),
);
const main = await call("GET", `/api/profiles/${rid}/main`, undefined, headers);
expect("bot mode ensure", main.status === 200 && main.json.kind === "main");
const reset = await call("POST", `/api/profiles/${rid}/main/reset`, undefined, headers);
expect("bot mode reset rotates", reset.status === 200 && reset.json.id !== main.json.id);

const scoped = await call("POST", "/api/sessions", { title: "scoped", profileId: rid }, headers);
expect("session under profile", scoped.status === 200 && scoped.json.profile === rid);
const scopedList = await call("GET", "/api/sessions?profile=" + rid, undefined, headers);
expect(
  "sessions filter by profile",
  scopedList.json.some((s: { id: string }) => s.id === scoped.json.id),
);

// Artifacts partition per profile: uploads through a session land in its scope.
const scopedUpload = await fetch(`${base}/api/artifacts?name=note.md&sessionId=${scoped.json.id}`, {
  method: "POST",
  body: "# scoped",
  headers,
});
const scopedArtifact = (await scopedUpload.json()) as { profile: string; owner: string };
expect(
  "artifact upload scoped",
  scopedUpload.status === 200 &&
    scopedArtifact.profile === rid &&
    scopedArtifact.owner === "smoker",
);
const scopedArtifacts = await call("GET", `/api/artifacts?profile=${rid}`, undefined, headers);
expect("artifact list by profile", scopedArtifacts.json.length === 1);

// Mailbox: human-instructed send is admitted; unknown targets refuse.
const cosProfile = await call("POST", "/api/profiles", { name: "CoS" }, headers);
const message = await call(
  "POST",
  `/api/profiles/${cosProfile.json.id}/messages`,
  { to: rid, kind: "request", body: "status?", topic: "smoke check" },
  headers,
);
expect("mailbox send admitted", message.status === 200 && message.json.status === "pending");
const refused = await call(
  "POST",
  `/api/profiles/${cosProfile.json.id}/messages`,
  { to: "nope", kind: "request", body: "x" },
  headers,
);
expect("mailbox refuses unknown target", refused.status === 400);
const mailboxList = await call("GET", "/api/mailbox", undefined, headers);
expect("mailbox list", mailboxList.status === 200 && mailboxList.json.length >= 1);

// Rooms: the exchange lives in a contextual room with per-bot seats —
// never in either bot's session list.
await new Promise((resolve) => setTimeout(resolve, 300));
const roomsList = await call("GET", "/api/rooms", undefined, headers);
expect("room created for the exchange", roomsList.status === 200 && roomsList.json.length >= 1);
const roomId = roomsList.json[0].id as string;
const roomDetail = await call("GET", `/api/rooms/${roomId}`, undefined, headers);
expect(
  "room detail is one merged chat with participant names",
  roomDetail.status === 200 &&
    roomDetail.json.participants.length === 2 &&
    Array.isArray(roomDetail.json.timeline) &&
    roomDetail.json.participants.every((p: { name: string }) => typeof p.name === "string"),
);
const allSessions = await call("GET", "/api/sessions", undefined, headers);
expect(
  "rooms never appear in sessions",
  allSessions.json.every((row: { kind: string }) => row.kind !== "room"),
);
const said = await call(
  "POST",
  `/api/rooms/${roomId}/say`,
  { to: rid, text: "supervision ping" },
  headers,
);
expect("room say", said.status === 200 && said.json.ok === true);

// Main bot: switchable, one at a time; the main bot is not removable.
const mainBefore = await call("GET", "/api/main", undefined, headers);
expect("main defaults", mainBefore.json.profileId === "default");
const deleteMain = await call("DELETE", "/api/profiles/default", undefined, headers);
expect("main bot protected", deleteMain.status === 409);
const setMain = await call("POST", `/api/profiles/${rid}/main`, undefined, headers);
expect("set main", setMain.status === 200);
const mainAfter = await call("GET", "/api/main", undefined, headers);
expect("main switched", mainAfter.json.profileId === rid);
const deleteOld = await call("DELETE", "/api/profiles/default", undefined, headers);
expect("non-main bot removable", deleteOld.status === 200 && deleteOld.json.ok === true);
const afterDelete = await call("GET", "/api/profiles", undefined, headers);
expect(
  "deleted bot stays deleted (no resurrection)",
  afterDelete.json.every((p: { id: string }) => p.id !== "default"),
);

// Vault: secrets seal; responses carry masks only.
const login = await call(
  "POST",
  "/api/vault",
  {
    kind: "login",
    name: "Gmail",
    login: { url: "https://mail.google.com", username: "smoker@gmail.com", password: "hunter2" },
  },
  headers,
);
expect(
  "vault seals and masks",
  login.status === 200 &&
    login.json.masked.includes("smoker@gmail.com") &&
    !JSON.stringify(login.json).includes("hunter2"),
);
const vaultList = await call("GET", "/api/vault", undefined, headers);
expect("vault list metadata only", vaultList.status === 200 && vaultList.json.length === 1);

// Approvals inbox + memory.
const approvals = await call("GET", "/api/approvals", undefined, headers);
expect("approval inbox empty", approvals.status === 200 && approvals.json.length === 0);
const memoryWrite = await call("POST", "/api/memory", { text: "smoker prefers brevity" }, headers);
expect("owner memory write", memoryWrite.status === 200);
const memoryRead = await call("GET", "/api/memory", undefined, headers);
expect("owner memory read", memoryRead.json.length === 1);

if (failures.length > 0) {
  console.error(`smoke FAILED: ${failures.join(", ")}`);
  await stack.close();
  process.exit(1);
}
console.log(`smoke ok: stack exercised REST on 127.0.0.1:${port}`);
await stack.close();
rmSync(scratchVault, { recursive: true, force: true });
rmSync(scratchArtifacts, { recursive: true, force: true });
console.log("smoke ok: closed cleanly");
