/** Cron routes: the registry, profile-stamped and rendered in the profile's timezone. */
import { createCronJob, isValidSchedule, listCronJobs, removeCronJob } from "../cron.ts";
import { queryOr, type RouteArgs } from "./types.ts";

export async function cronRoutes(
  args: RouteArgs,
  segment: (after: string) => string,
): Promise<boolean> {
  const { req, mind, scheduler, path, json } = args;
  const method = req.method ?? "GET";
  if (path === "/api/cron" && method === "GET") {
    const profile = queryOr(args, "profile");
    const jobs = await listCronJobs(mind);
    json(200, profile !== undefined ? jobs.filter((job) => job.profile === profile) : jobs);
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
