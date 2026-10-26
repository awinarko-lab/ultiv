/** Task routes: spawn/status/list/remove over the mind's tasks faculty. */
import { taskConversationKey } from "@ultiv/mind";
import { Effect } from "effect";
import { queryOr, type RouteArgs } from "./types.ts";

export async function taskRoutes(
  args: RouteArgs,
  segment: (after: string) => string,
): Promise<boolean> {
  const { req, mind, path, json } = args;
  const method = req.method ?? "GET";
  if (path === "/api/tasks" && method === "GET") {
    json(200, await Effect.runPromise(mind.tasks.list()));
    return true;
  }
  if (path === "/api/tasks" && method === "POST") {
    const body = await args.readJson<{ sessionId?: string; prompt?: string }>(req);
    if (body.prompt === undefined || body.prompt.trim() === "") {
      json(400, { error: "prompt is required" });
      return true;
    }
    const spawnerConversationId =
      body.sessionId !== undefined && body.sessionId !== ""
        ? ((await Effect.runPromise(
            mind.converse.conversationIdOf(
              await mind.profiles.keyForSession(args.owner, body.sessionId),
            ),
          )) ?? null)
        : null;
    const task = await Effect.runPromise(
      mind.tasks.spawn({
        sessionId: body.sessionId ?? "",
        owner: args.owner,
        conversationId: spawnerConversationId,
        prompt: body.prompt,
      }),
    );
    // The task runs AS the bot whose session spawned it (messaging, artifacts,
    // memory scope) — unscoped only when no session context was given.
    if (spawnerConversationId !== null) {
      await mind.profiles.adoptTaskConversation(
        taskConversationKey(task.id),
        spawnerConversationId,
      );
    }
    json(200, task);
    return true;
  }
  if (path.startsWith("/api/tasks/") && method === "GET") {
    const task = await Effect.runPromise(mind.tasks.get(segment("/api/tasks/")));
    if (task === undefined) json(404, { error: "unknown task" });
    else json(200, task);
    return true;
  }
  if (path.startsWith("/api/tasks/") && method === "DELETE") {
    const id = segment("/api/tasks/");
    const task = await Effect.runPromise(mind.tasks.get(id));
    if (task === undefined) {
      json(404, { error: "unknown task" });
      return true;
    }
    const mayManage = task.owner === args.owner || task.owner === "agent" || args.owner !== "guest";
    if (!mayManage) {
      json(403, { error: "not your task" });
      return true;
    }
    json(200, { ok: true, ...(await Effect.runPromise(mind.tasks.remove(id))) });
    return true;
  }
  void queryOr;
  return false;
}
