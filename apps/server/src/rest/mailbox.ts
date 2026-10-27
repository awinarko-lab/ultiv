/** Mailbox routes: human-instructed sends (origin "human") and the read surfaces. */
import { errorOf, type RouteArgs } from "./types.ts";

export async function mailboxRoutes(args: RouteArgs): Promise<boolean> {
  const { req, mind, path, json } = args;
  const method = req.method ?? "GET";
  if (path === "/api/mailbox" && method === "GET") {
    json(200, (await mind.mailbox.list(args.owner)).slice(-100).reverse());
    return true;
  }
  if (path === "/api/mailbox/dead" && method === "GET") {
    json(200, await mind.mailbox.dead(args.owner));
    return true;
  }
  const cancel = path.match(/^\/api\/mailbox\/([^/]+)\/cancel$/);
  if (cancel !== null && method === "POST") {
    try {
      json(200, await mind.mailbox.cancel(args.owner, decodeURIComponent(cancel[1] ?? "")));
    } catch (cause) {
      json(404, { error: errorOf(cause) });
    }
    return true;
  }
  const send = path.match(/^\/api\/profiles\/([^/]+)\/messages$/);
  if (send !== null && method === "POST") {
    const profile = await mind.profiles.get(args.owner, send[1] ?? "");
    if (profile === undefined) {
      json(404, { error: "unknown profile" });
      return true;
    }
    const body = await args.readJson<{
      to?: string;
      kind?: string;
      body?: string;
      artifacts?: string[];
    }>(req);
    if (body.to === undefined || body.body === undefined || body.body.trim() === "") {
      json(400, { error: "to and body are required" });
      return true;
    }
    const kind = body.kind === "notify" ? "notify" : "request";
    try {
      json(
        200,
        await mind.mailbox.send({
          owner: args.owner,
          from: profile.id,
          to: body.to,
          kind,
          body: body.body,
          ...(body.artifacts !== undefined ? { artifacts: body.artifacts } : {}),
          origin: "human",
        }),
      );
    } catch (cause) {
      json(400, { error: errorOf(cause) });
    }
    return true;
  }
  return false;
}
