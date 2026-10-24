// Boots the full server stack on an ephemeral port and closes it cleanly.
// Run: pnpm --filter @ultiv/server smoke  (or npm run smoke at the root)
import { buildStack } from "./main.ts";

const stack = await buildStack();
await new Promise<void>((resolve, reject) => {
  stack.http.once("listening", resolve);
  stack.http.once("error", reject);
  stack.http.listen(0, "127.0.0.1");
});
const address = stack.http.address();
const port = typeof address === "object" && address !== null ? address.port : address;
console.log(`smoke ok: stack listening on 127.0.0.1:${port}`);
await stack.close();
console.log("smoke ok: closed cleanly");
