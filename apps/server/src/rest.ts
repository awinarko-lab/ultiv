/**
 * The REST surface: session registry, model catalog, tasks, artifacts,
 * webhooks (also the `/hooks/:id` ingress), cron jobs and the audit tail.
 * Plain REST on purpose — CRUD over chord's replicated-object wire desyncs on
 * attach (chord 1.4.0 ack-window bug). Owner scoping rides `x-ultiv-user`.
 */
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect } from "effect";
import {
  artifactFile,
  artifactsDir,
  clearArtifacts,
  deleteArtifact,
  mimeOfName,
  readArtifact,
  searchArtifacts,
  writeArtifact,
} from "@ultiv/ext";
import { KENARI_MODELS, type MindService } from "@ultiv/mind";
import {
  createCronJob,
  isValidSchedule,
  listCronJobs,
  removeCronJob,
  type CronScheduler,
} from "./cron.ts";
import { ownerOf, principalFromRequest, sessionKey } from "./identity.ts";
import { createSession, listSessions, removeSession } from "./sessions.ts";
import { callWebhook, createWebhook, listWebhooks, removeWebhook } from "./webhooks.ts";

export interface RestDeps {
  readonly mind: MindService;
  readonly scheduler: CronScheduler;
}

interface RouteArgs {
  readonly mind: MindService;
  readonly scheduler: CronScheduler;
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly url: URL;
  readonly owner: string;
  readonly path: string;
  readonly json: (status: number, body: unknown) => void;
  readonly readJson: <T>(req: IncomingMessage) => Promise<T>;
  readonly readBody: (req: IncomingMessage) => Promise<Buffer>;
}

const readBody = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

const readJson = async <T>(req: IncomingMessage): Promise<T> => {
  const raw = (await readBody(req)).toString("utf8");
  return (raw === "" ? {} : JSON.parse(raw)) as T;
};

export const createRestHandler = (deps: RestDeps) => {
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, x-ultiv-user",
  };
  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    const args: RouteArgs = {
      mind: deps.mind,
      scheduler: deps.scheduler,
      req,
      res,
      url,
      owner: ownerOf(principalFromRequest(req)),
      path: url.pathname,
      json,
      readJson,
      readBody,
    };
    void route(args).catch((error) => json(500, { error: String(error).slice(0, 300) }));
  };
};

async function route(args: RouteArgs): Promise<void> {
  const { req, path, json } = args;
  const method = req.method ?? "GET";
  const segment = (after: string): string => decodeURIComponent(path.slice(after.length));

  if (path === "/api/sessions" && method === "GET") {
    return json(200, await listSessions(args.mind, args.owner));
  }
  if (path === "/api/sessions" && method === "POST") {
    const body = await args.readJson<{ title?: string | null }>(req);
    return json(200, await createSession(args.mind, args.owner, body.title ?? null));
  }
  if (path.startsWith("/api/sessions/") && method === "DELETE") {
    return json(200, { ok: await removeSession(args.mind, args.owner, segment("/api/sessions/")) });
  }
  if (path === "/api/models") {
    return json(
      200,
      KENARI_MODELS.map((spec) => ({
        id: spec.id,
        label: spec.label,
        efforts: [...spec.efforts],
        defaultEffort: spec.defaultEffort,
      })),
    );
  }
  if (await taskRoutes(args, segment)) return;
  if (await artifactRoutes(args, segment)) return;
  if (await webhookRoutes(args, segment)) return;
  if (await cronRoutes(args, segment)) return;
  if (path === "/api/audit" && method === "GET") {
    const limit = Number(args.url.searchParams.get("limit") ?? "100");
    const capped = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 1_000) : 100;
    return json(200, args.mind.audit.tail(capped));
  }
  if (path === "/" || path === "/api/health") return json(200, { app: "ultiv", ok: true });
  json(404, { error: `no route: ${method} ${path}` });
}

async function taskRoutes(args: RouteArgs, segment: (after: string) => string): Promise<boolean> {
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
    const task = await Effect.runPromise(
      mind.tasks.spawn({
        sessionId: body.sessionId ?? "",
        owner: args.owner,
        conversationId:
          body.sessionId !== undefined && body.sessionId !== ""
            ? ((await Effect.runPromise(
                mind.converse.conversationIdOf(sessionKey(args.owner, body.sessionId)),
              )) ?? null)
            : null,
        prompt: body.prompt,
      }),
    );
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
    // Remove a task from the registry; a running task is cancelled first
    // (its parent is woken). Agent-owned tasks are manageable by any
    // identified principal; guests may manage their own and agent tasks.
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
  return false;
}

async function artifactRoutes(
  args: RouteArgs,
  segment: (after: string) => string,
): Promise<boolean> {
  const { req, mind, path, json, res } = args;
  const method = req.method ?? "GET";
  const dir = artifactsDir();
  if (path === "/api/artifacts" && method === "GET") {
    // Filters: ?conversationId= exact, ?q= name/content search, ?sessionId= resolved
    // through the caller's owner scope.
    const sessionId = queryOr(args, "sessionId");
    const mapped =
      sessionId !== undefined
        ? await Effect.runPromise(mind.converse.conversationIdOf(sessionKey(args.owner, sessionId)))
        : undefined;
    const conversationId = queryOr(args, "conversationId") ?? mapped;
    const filter: { conversationId?: string; query?: string } = {};
    if (conversationId !== undefined && conversationId !== null) {
      filter.conversationId = conversationId;
    }
    const q = queryOr(args, "q");
    if (q !== undefined) filter.query = q;
    json(200, searchArtifacts(dir, filter));
    return true;
  }
  if (path === "/api/artifacts" && method === "POST") {
    const name = queryOr(args, "name") ?? "upload.bin";
    const mime = queryOr(args, "mime") ?? mimeOfName(name);
    const sessionId = queryOr(args, "sessionId");
    const conversationId =
      sessionId !== undefined
        ? ((await Effect.runPromise(
            mind.converse.conversationIdOf(sessionKey(args.owner, sessionId)),
          )) ?? null)
        : null;
    const body = await args.readBody(req);
    json(200, writeArtifact(dir, { name, mime, content: body.toString("utf8"), conversationId }));
    return true;
  }
  if (path === "/api/artifacts" && method === "DELETE") {
    // Owner-level clear: an identified principal only; guests get nothing.
    if (args.owner === "guest") {
      json(403, { error: "clearing the workspace requires an identified user" });
      return true;
    }
    json(200, { ok: true, cleared: clearArtifacts(dir) });
    return true;
  }
  if (path.startsWith("/api/artifacts/") && method === "GET") {
    const id = segment("/api/artifacts/");
    const file = artifactFile(dir, id);
    const found = readArtifact(dir, id);
    if (file === undefined || found === undefined) {
      json(404, { error: "unknown artifact" });
      return true;
    }
    res.writeHead(200, { "content-type": found.info.mime });
    res.end(readFileSync(file));
    return true;
  }
  if (path.startsWith("/api/artifacts/") && method === "DELETE") {
    const deleted = deleteArtifact(dir, segment("/api/artifacts/"));
    if (deleted) json(200, { ok: true });
    else json(404, { error: "unknown artifact" });
    return true;
  }
  return false;
}

function queryOr(args: RouteArgs, key: string): string | undefined {
  const value = args.url.searchParams.get(key);
  return value !== null && value.trim() !== "" ? value : undefined;
}

async function webhookRoutes(
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

async function cronRoutes(args: RouteArgs, segment: (after: string) => string): Promise<boolean> {
  const { req, mind, scheduler, path, json } = args;
  const method = req.method ?? "GET";
  if (path === "/api/cron" && method === "GET") {
    json(200, await listCronJobs(mind));
    return true;
  }
  if (path === "/api/cron" && method === "POST") {
    const body = await args.readJson<{ sessionId?: string; schedule?: string; prompt?: string }>(
      req,
    );
    if (
      body.sessionId === undefined ||
      body.schedule === undefined ||
      body.prompt === undefined ||
      !isValidSchedule(body.schedule)
    ) {
      json(400, { error: "sessionId, schedule (valid cron) and prompt are required" });
      return true;
    }
    const job = await createCronJob(mind, {
      sessionId: body.sessionId,
      schedule: body.schedule,
      prompt: body.prompt,
    });
    await scheduler.refresh();
    json(200, job);
    return true;
  }
  if (path.startsWith("/api/cron/") && method === "DELETE") {
    const removed = await removeCronJob(mind, segment("/api/cron/"));
    await scheduler.refresh();
    json(200, { ok: removed });
    return true;
  }
  return false;
}
