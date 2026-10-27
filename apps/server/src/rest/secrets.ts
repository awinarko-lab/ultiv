/**
 * Secure input: the browser posts typed keys here, straight into the vault.
 * Values are never logged, echoed, audited or handed to the model - the
 * response names the stored items only. Owner-scoped: a request can only be
 * answered by the owner whose bot asked.
 */
import type { RouteArgs } from "./types.ts";

const isValues = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export async function secretRoutes(args: RouteArgs): Promise<boolean> {
  const { req, mind, path, json } = args;
  const match = path.match(/^\/api\/secrets\/([^/]+)$/);
  if (match === null || req.method !== "POST") return false;
  const callId = decodeURIComponent(match[1] ?? "");
  let body: { values?: unknown; cancel?: unknown };
  try {
    body = await args.readJson<{ values?: unknown; cancel?: unknown }>(req);
  } catch {
    json(400, { error: "send JSON" });
    return true;
  }
  if (body.cancel === true) {
    const cancelled = mind.secrets.cancel(args.owner, callId);
    json(
      cancelled ? 200 : 404,
      cancelled ? { ok: true } : { error: "this request is no longer waiting" },
    );
    return true;
  }
  if (!isValues(body.values)) {
    json(400, { error: "nothing to store" });
    return true;
  }
  const result = mind.secrets.submit(args.owner, callId, body.values);
  json(
    result.ok ? 200 : result.status,
    result.ok ? { ok: true, stored: result.stored } : { error: result.error },
  );
  return true;
}
