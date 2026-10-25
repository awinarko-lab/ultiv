/**
 * The cross-profile approval inbox: every pending gate in one list, plus
 * REST decide. Owner scoping rides the conversation→profile index.
 */
import type { RouteArgs } from "./types.ts";

export async function approvalRoutes(args: RouteArgs): Promise<boolean> {
  const { req, mind, path, json } = args;
  const method = req.method ?? "GET";
  if (path === "/api/approvals" && method === "GET") {
    const pending = mind.approvals.pendingAll().flatMap((entry) => {
      const scope = mind.profiles.scopeOf(entry.conversationId);
      if (scope?.owner !== args.owner) return [];
      return [
        {
          conversationId: entry.conversationId,
          profile: scope.profileId,
          kind: scope.kind,
          sessionId: null,
          callId: entry.request.callId,
          name: entry.request.name,
          input: entry.request.input,
        },
      ];
    });
    json(200, pending);
    return true;
  }
  const decide = path.match(/^\/api\/approvals\/([^/]+)\/([^/]+)$/);
  if (decide !== null && method === "POST") {
    const [, conversationId, callId] = decide;
    const scope = mind.profiles.scopeOf(conversationId ?? "");
    if (scope?.owner !== args.owner) {
      json(403, { error: "not your conversation" });
      return true;
    }
    const body = await args.readJson<{ approved?: boolean }>(req);
    const approved = body.approved === true;
    mind.approvals.decide(conversationId ?? "", callId ?? "", approved);
    mind.audit.record({
      at: Date.now(),
      kind: "approval",
      conversationId: conversationId ?? "",
      profile: scope.profileId,
      callId: callId ?? "",
      name: null,
      durationMs: null,
      ok: approved,
      error: null,
    });
    json(200, { ok: true });
    return true;
  }
  return false;
}
