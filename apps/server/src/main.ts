import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { acceptWebSockets, createHost } from "@earendil-works/chord";
import type { Storage } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { WebSocketServer } from "ws";
import { Ping } from "@ultiv/contracts";
import { httpPlugin } from "@ultiv/ext";
import { KENARI_MODELS, openMind } from "@ultiv/mind";
import { createSession, listSessions, removeSession } from "./sessions.ts";
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

  // Session registry + model catalog as plain REST: CRUD over chord's
  // replicated-object wire desyncs on attach (chord 1.4.0 ack-window bug).
  const http = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const headers = {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type",
    };
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    const readBody = async (): Promise<{ title?: string | null }> => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      return raw === "" ? {} : (JSON.parse(raw) as { title?: string | null });
    };
    void (async () => {
      try {
        if (url.pathname === "/api/sessions" && req.method === "GET") {
          json(200, await listSessions(mind));
        } else if (url.pathname === "/api/sessions" && req.method === "POST") {
          const body = await readBody();
          json(200, await createSession(mind, body.title ?? null));
        } else if (url.pathname.startsWith("/api/sessions/") && req.method === "DELETE") {
          const id = decodeURIComponent(url.pathname.slice("/api/sessions/".length));
          json(200, { ok: await removeSession(mind, id) });
        } else if (url.pathname === "/api/models") {
          json(
            200,
            KENARI_MODELS.map((spec) => ({
              id: spec.id,
              label: spec.label,
              efforts: [...spec.efforts],
              defaultEffort: spec.defaultEffort,
            })),
          );
        } else {
          json(200, { app: "ultiv", ok: true });
        }
      } catch (error) {
        json(500, { error: String(error).slice(0, 300) });
      }
    })();
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
