import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { acceptWebSockets, createHost } from "@earendil-works/chord";
import type { Storage } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { WebSocketServer } from "ws";
import { Ping } from "@ultiv/contracts";
import { httpPlugin } from "@ultiv/ext";
import { openMind } from "@ultiv/mind";
import { loadSessionCache, serveSessions } from "./sessions.ts";
import { serveSession } from "./session.ts";

export type Principal = { kind: "guest" } | { kind: "server" };

/**
 * Wires the mind (the platform's AI entity), the chord host, and the
 * WebSocket + HTTP listeners. The app is thin: state and transport live here;
 * every AI capability lives in @ultiv/mind.
 */
export async function buildStack(options?: { readonly storage?: Storage }) {
  const handle = await openMind({
    plugins: [httpPlugin],
    ...(options?.storage !== undefined ? { storage: options.storage } : {}),
  });
  const mind = handle.mind;
  const host = createHost<Principal>({ name: "server", self: { kind: "server" } });
  host.serve(Ping, (_input, _principal, self) => {
    const count = self.state("count", Type.Number(), 0);
    return {
      variant: "default",
      count,
      increment: async ({ by }, ctx) => {
        count.change(ctx, (n) => n + by);
      },
    };
  });
  serveSession(host, mind);
  await loadSessionCache(mind);
  serveSessions(host, mind);

  const http = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ app: "ultiv", ok: true }));
  });
  const wss = new WebSocketServer({ server: http });
  const guest: Principal = { kind: "guest" };
  acceptWebSockets(wss, host, { principal: async () => guest });

  const close = async () => {
    // Drop connected links first: wss.close() waits for clients otherwise, so
    // one live browser tab would block shutdown (and node --watch restarts) forever.
    for (const client of wss.clients) client.terminate();
    await Promise.allSettled([
      new Promise<void>((resolve) => wss.close(() => resolve())),
      new Promise<void>((resolve) => http.close(() => resolve())),
    ]);
    await handle.close();
  };
  return { host, mind, http, close };
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT ?? 8787);
  const stack = await buildStack();
  stack.http.listen(port, "127.0.0.1", () => {
    console.log(`ultiv server listening on http://127.0.0.1:${port}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void stack.close().then(() => process.exit(0));
    });
  }
}
