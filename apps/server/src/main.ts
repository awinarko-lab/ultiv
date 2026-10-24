import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { acceptWebSockets, createHost } from "@earendil-works/chord";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import type { Storage } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { Type } from "typebox";
import { WebSocketServer } from "ws";
import { Ping } from "@ultiv/contracts";
import { serveChat } from "./chat.ts";
import { kenariProvider } from "./ai/kenari.ts";
import { jevClient } from "./ai/typesafe.ts";

export type Principal = { kind: "guest" } | { kind: "server" };

/** File-backed durable storage (HARNESS_DB overrides the default path). */
async function openStorage(): Promise<Storage> {
  const path = process.env.HARNESS_DB ?? "var/harness.sqlite";
  mkdirSync(dirname(path), { recursive: true });
  return openNodeSqliteStorage(path);
}

/** Wires the durable harness, the chord host, and the WebSocket + HTTP listeners. */
export async function buildStack(options?: { readonly storage?: Storage }) {
  const storage = options?.storage ?? (await openStorage());
  const models = createModels();
  if (process.env.OPENAI_API_KEY) models.setProvider(openaiProvider());
  if (process.env.KENARI_API_KEY) models.setProvider(kenariProvider());

  const harness = await Harness.open(
    storage,
    { models, registry: createRegistry() },
    BACKGROUND_CONTEXT,
  );
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
  serveChat(host, harness);

  const http = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ app: "ultiv", ok: true }));
  });
  const wss = new WebSocketServer({ server: http });
  const guest: Principal = { kind: "guest" };
  acceptWebSockets(wss, host, { principal: async () => guest });

  const close = async () => {
    await Promise.allSettled([
      new Promise<void>((resolve) => wss.close(() => resolve())),
      new Promise<void>((resolve) => http.close(() => resolve())),
    ]);
    await harness.close(BACKGROUND_CONTEXT);
  };
  const jev = process.env.TYPESAFE_API_KEY ? jevClient() : undefined;
  return { host, harness, http, jev, close };
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
