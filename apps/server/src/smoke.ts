// Boots the full server stack on an ephemeral port and closes it cleanly.
// Run: pnpm --filter @ultiv/server smoke  (or npm run smoke at the root)
import { buildStack } from "./main.ts";
import { Chat } from "@ultiv/contracts";

const stack = await buildStack();
await new Promise<void>((resolve, reject) => {
  stack.http.once("listening", resolve);
  stack.http.once("error", reject);
  stack.http.listen(0, "127.0.0.1");
});
// The Chat object must activate offline: its harness root is created lazily on first send.
const chat = await stack.host.get(Chat, { id: "smoke" });
chat.release();
const address = stack.http.address();
const port = typeof address === "object" && address !== null ? address.port : address;
console.log(`smoke ok: stack listening on 127.0.0.1:${port}`);
await stack.close();
console.log("smoke ok: closed cleanly");
