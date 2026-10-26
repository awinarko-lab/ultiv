/**
 * Wires the mind (the platform's AI entity), the chord host, and the
 * WebSocket + HTTP + REST listeners. The app is thin: transport and registry
 * REST live here; every AI capability lives in @ultiv/mind.
 */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { acceptWebSockets, createHost } from "@earendil-works/chord";
import type { Storage } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { WebSocketServer } from "ws";
import { Ping } from "@ultiv/contracts";
import { artifactsDir, copyArtifact } from "@ultiv/ext";
import { join } from "node:path";
import { httpPlugin } from "@ultiv/ext";
import { closeWebhookPump } from "./webhooks.ts";
import { openMind } from "@ultiv/mind";
import { startScheduler, type CronScheduler } from "./cron.ts";
import { principalFromRequest, type Principal } from "./identity.ts";
import { createRestHandler } from "./rest.ts";
import { serveSession } from "./session.ts";

export type { Principal } from "./identity.ts";

/**
 * Boots the whole stack: mind, chord host, cron scheduler, REST + WebSocket
 * listeners. `close()` stops the scheduler, drops links, then closes the
 * mind's scope (harness finalizers).
 */
export async function buildStack(options?: {
  readonly storage?: Storage;
  readonly vault?: { readonly dir?: string };
}) {
  const handle = await openMind({
    plugins: [httpPlugin],
    // Schedules created by tools re-arm the in-process scheduler; the closure
    // is late-bound — `startScheduler` runs right after the mind opens.
    schedules: { onChanged: () => refreshSchedules() },
    ...(options?.storage !== undefined ? { storage: options.storage } : {}),
    ...(options?.vault !== undefined ? { vault: options.vault } : {}),
    // Envelope artifact grants materialize as file copies between the bots'
    // per-profile stores (the mailbox calls this on delivery).
    mailbox: {
      grantArtifacts: async (owner, from, to, ids) => {
        const base = artifactsDir();
        for (const id of ids) {
          copyArtifact(join(base, owner, from), join(base, owner, to), id);
        }
      },
    },
  });
  const mind = handle.mind;
  let refreshSchedules: () => Promise<void> = async () => undefined;
  const scheduler: CronScheduler = await startScheduler(mind);
  refreshSchedules = () => scheduler.refresh();
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

  const http = createServer(createRestHandler({ mind, scheduler }));
  const wss = new WebSocketServer({ server: http });
  // The upgrade request IS the credential for now: x-ultiv-user scopes the
  // link's principal (see identity.ts for the seam a real IdP replaces).
  acceptWebSockets(wss, host, { principal: async (request) => principalFromRequest(request) });

  const close = async () => {
    scheduler.stop();
    // Pending webhook windows first: a flush racing the mind's teardown
    // would otherwise write into a closed session.
    closeWebhookPump();
    // Drop connected links first: wss.close() waits for clients otherwise, so
    // one live browser tab would block shutdown (and node --watch restarts) forever.
    for (const client of wss.clients) client.terminate();
    await Promise.allSettled([
      new Promise<void>((resolve) => wss.close(() => resolve())),
      new Promise<void>((resolve) => http.close(() => resolve())),
    ]);
    await handle.close();
  };
  return { host, mind, http, scheduler, close };
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT ?? 8787);
  // Default 0.0.0.0 so the tailnet can reach the server; HOST narrows it.
  const host = process.env.HOST ?? "0.0.0.0";
  const stack = await buildStack();
  stack.http.listen(port, host, () => {
    console.log(`ultiv server listening on http://${host}:${port}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void stack.close().then(() => process.exit(0));
    });
  }
}
