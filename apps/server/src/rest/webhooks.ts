/** Webhook routes: the registry plus the `/hooks/:id` ingress. */
import { callWebhook, createWebhook, listWebhooks, removeWebhook } from "../webhooks.ts";
import type { RouteArgs } from "./types.ts";

export async function webhookRoutes(
  args: RouteArgs,
  segment: (after: string) => string,
): Promise<boolean> {
  const { req, mind, path, json } = args;
  const method = req.method ?? "GET";
  if (path === "/api/webhooks" && method === "GET") {
    json(200, await listWebhooks(mind));
    return true;
  }
  if (path === "/api/webhooks" && method === "POST") {
    const body = await args.readJson<{ sessionId?: string }>(req);
    if (body.sessionId === undefined || body.sessionId.trim() === "") {
      json(400, { error: "sessionId is required" });
      return true;
    }
    json(200, await createWebhook(mind, body.sessionId));
    return true;
  }
  if (path.startsWith("/api/webhooks/") && method === "DELETE") {
    json(200, { ok: await removeWebhook(mind, segment("/api/webhooks/")) });
    return true;
  }
  if (path.startsWith("/hooks/") && method === "POST") {
    const token = args.url.searchParams.get("token") ?? req.headers["x-ultiv-token"] ?? "";
    const body = (await args.readBody(req)).toString("utf8");
    const matched = await callWebhook(mind, segment("/hooks/"), String(token), body);
    if (matched) json(200, { ok: true });
    else json(404, { error: "unknown webhook or bad token" });
    return true;
  }
  return false;
}
