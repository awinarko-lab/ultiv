/**
 * The Schedules faculty: cron and one-shot triggers the entity can set on
 * ITSELF. Jobs live in a durable registry doc (kind "ultiv.cronjobs", moved
 * here from the server verbatim — same kind, same stored shape); the server's
 * scheduler arms them and delivers through the trigger path. Recurring jobs
 * use 5-field cron in the profile's timezone; one-shot jobs carry an epoch-ms
 * `once` and remove themselves after firing.
 */
import { randomUUID } from "node:crypto";
import { defineDoc } from "@earendil-works/pi-durable";
import { Cron } from "croner";
import { Effect } from "effect";
import type { CronJobInfo, CronJobList } from "@ultiv/contracts";
import type { ConverseService } from "../converse/converse.ts";
import type { ProfilesService } from "../profiles/profiles.ts";

export const CronDoc = defineDoc<{ items: CronJobInfo[] }>({
  kind: "ultiv.cronjobs",
  version: 2,
  scope: "session",
  initial: () => ({ items: [] }),
  // v1 rows predate profile scoping and the failure counter.
  migrate: (value) => {
    const stored = (value.items ?? []) as unknown as ReadonlyArray<Record<string, unknown>>;
    const items = stored.map((row) => ({
      ...row,
      profile: typeof row.profile === "string" ? row.profile : "default",
      failures: typeof row.failures === "number" ? row.failures : 0,
    }));
    return { items } as unknown as { items: CronJobInfo[] };
  },
  checkpointWhen: () => true,
});

export const readCronJobs = async (converse: ConverseService): Promise<CronJobList> =>
  ((await Effect.runPromise(converse.docs.snapshot(CronDoc)))?.items ?? []).map((job) => ({
    ...job,
    profile: job.profile ?? "default",
    failures: job.failures ?? 0,
    once: job.once ?? null,
  }));

export const writeCronJobs = (converse: ConverseService, items: CronJobInfo[]) =>
  converse.docs.commit(async (tx) => {
    const draft = await tx.doc(CronDoc);
    draft.items = items;
  });

export const listCronJobs = (converse: ConverseService): Promise<CronJobList> =>
  readCronJobs(converse);

/** `true` when the expression is a schedule croner can fire. */
export const isValidSchedule = (schedule: string): boolean => {
  try {
    const cron = new Cron(schedule, () => undefined);
    const valid = cron.nextRun() !== null;
    cron.stop();
    return valid;
  } catch {
    return false;
  }
};

/** A job start is either a valid cron expression or a future one-shot epoch. */
export const isValidJobStart = (schedule: string, once: number | null | undefined): boolean =>
  once !== undefined && once !== null
    ? Number.isFinite(once) && once > Date.now()
    : isValidSchedule(schedule);

export interface CronJobCreate {
  readonly sessionId: string;
  readonly schedule: string;
  readonly once?: number | null;
  readonly prompt: string;
  readonly enabled?: boolean;
}

export const createCronJob = async (
  converse: ConverseService,
  profiles: ProfilesService,
  input: CronJobCreate,
): Promise<CronJobInfo> => {
  const row = await profiles.rowOf(input.sessionId);
  const job: CronJobInfo = {
    id: randomUUID(),
    sessionId: input.sessionId,
    profile: row?.profile ?? "default",
    schedule: input.schedule,
    ...(input.once !== undefined && input.once !== null ? { once: input.once } : {}),
    prompt: input.prompt,
    enabled: input.enabled ?? true,
    failures: 0,
    createdAt: Date.now(),
    lastRunAt: null,
    lastError: null,
  };
  const items = await readCronJobs(converse);
  await Effect.runPromise(writeCronJobs(converse, [...items, job]));
  return job;
};

export const removeCronJob = async (converse: ConverseService, id: string): Promise<boolean> => {
  const items = await readCronJobs(converse);
  const remaining = items.filter((job) => job.id !== id);
  if (remaining.length === items.length) return false;
  await Effect.runPromise(writeCronJobs(converse, remaining));
  return true;
};

/** Remove every job bound to one of the given sessions (profile purge cascade). */
export const removeCronJobsForSessions = async (
  converse: ConverseService,
  sessionIds: readonly string[],
): Promise<number> => {
  const items = await readCronJobs(converse);
  const bound = new Set(sessionIds);
  const remaining = items.filter((job) => !bound.has(job.sessionId));
  if (remaining.length !== items.length)
    await Effect.runPromise(writeCronJobs(converse, remaining));
  return items.length - remaining.length;
};

export interface SchedulesService {
  readonly list: () => Promise<CronJobList>;
  readonly create: (input: CronJobCreate) => Promise<CronJobInfo>;
  readonly remove: (id: string) => Promise<boolean>;
  readonly removeForSessions: (sessionIds: readonly string[]) => Promise<number>;
}

/** The schedules faculty over the shared registry doc. */
export const schedulesService = (deps: {
  readonly converse: ConverseService;
  readonly profiles: ProfilesService;
  /** Fired after every registry change so a live scheduler can re-arm. */
  readonly onChanged?: () => Promise<void>;
}): SchedulesService => {
  const changed = async (): Promise<void> => {
    if (deps.onChanged !== undefined) await deps.onChanged();
  };
  return {
    list: () => readCronJobs(deps.converse),
    create: async (input) => {
      const job = await createCronJob(deps.converse, deps.profiles, input);
      await changed();
      return job;
    },
    remove: async (id) => {
      const removed = await removeCronJob(deps.converse, id);
      if (removed) await changed();
      return removed;
    },
    removeForSessions: (sessionIds) => removeCronJobsForSessions(deps.converse, sessionIds),
  };
};
