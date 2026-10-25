// Boots the full server stack on an ephemeral port, exercises the REST
// surface, and closes it cleanly — all offline and ephemeral (MemoryStorage).
// Run: vpr smoke  (root), or vp run --filter @ultiv/server smoke
import { MemoryStorage } from "@earendil-works/pi-durable";
import { Session } from "@ultiv/contracts";
import { buildStack } from "./main.ts";

const stack = await buildStack({ storage: new MemoryStorage() });
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

if (failures.length > 0) {
  console.error(`smoke FAILED: ${failures.join(", ")}`);
  await stack.close();
  process.exit(1);
}
console.log(`smoke ok: stack exercised REST on 127.0.0.1:${port}`);
await stack.close();
console.log("smoke ok: closed cleanly");
