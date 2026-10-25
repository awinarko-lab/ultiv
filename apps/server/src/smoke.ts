// Boots the full server stack on an ephemeral port and closes it cleanly.
// Run: vpr smoke  (root), or vp run --filter @ultiv/server smoke
import { buildStack } from "./main.ts";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { Session } from "@ultiv/contracts";

// Smoke stays offline and ephemeral: MemoryStorage, no db file.
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
console.log(`smoke ok: stack listening on 127.0.0.1:${port}`);
await stack.close();
console.log("smoke ok: closed cleanly");
