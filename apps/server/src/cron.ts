/**
 * Cron triggers: schedules that deliver a prompt into a session. Jobs live in
 * a durable registry doc; the in-process scheduler arms one croner timer per
 * enabled job, fires deliveries through the same path as webhooks, and
 * records the outcome on the job. Restarting re-arms everything from the doc.
 */
import { Cron } from "croner";
import { randomUUID } from "node:crypto";
import { defineDoc } from "@earendil-works/pi-durable";
import { Effect } from "effect";
import type { CronJobInfo, CronJobList } from "@ultiv/contracts";
import type { MindService } from "@ultiv/mind";
import { deliverToSession } from "./deliver.ts";

const CronDoc = defineDoc<{ items: CronJobInfo[] }>({
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

const readJobs = async (mind: MindService): Promise<CronJobList> =>
  ((await Effect.runPromise(mind.converse.docs.snapshot(CronDoc)))?.items ?? []).map((job) => ({
    ...job,
    profile: job.profile ?? "default",
    failures: job.failures ?? 0,
  }));

const writeJobs = (mind: MindService, items: CronJobInfo[]) =>
  mind.converse.docs.commit(async (tx) => {
    const draft = await tx.doc(CronDoc);
    draft.items = items;
  });

export const listCronJobs = (mind: MindService): Promise<CronJobList> => readJobs(mind);

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

export const createCronJob = async (
  mind: MindService,
  input: { sessionId: string; schedule: string; prompt: string; enabled?: boolean },
): Promise<CronJobInfo> => {
  const row = await mind.profiles.rowOf(input.sessionId);
  const job: CronJobInfo = {
    id: randomUUID(),
    sessionId: input.sessionId,
    profile: row?.profile ?? "default",
    schedule: input.schedule,
    prompt: input.prompt,
    enabled: input.enabled ?? true,
    failures: 0,
    createdAt: Date.now(),
    lastRunAt: null,
    lastError: null,
  };
  const items = await readJobs(mind);
  await Effect.runPromise(writeJobs(mind, [...items, job]));
  return job;
};

export const removeCronJob = async (mind: MindService, id: string): Promise<boolean> => {
  const items = await readJobs(mind);
  const remaining = items.filter((job) => job.id !== id);
  if (remaining.length === items.length) return false;
  await Effect.runPromise(writeJobs(mind, remaining));
  return true;
};

const setJobOutcome = async (
  mind: MindService,
  id: string,
  outcome: {
    lastRunAt: number;
    lastError: string | null;
    failuresReset?: boolean;
    failures?: number;
    disable?: boolean;
  },
): Promise<void> => {
  const items = await readJobs(mind);
  await Effect.runPromise(
    writeJobs(
      mind,
      items.map((job) => {
        if (job.id !== id) return job;
        const failures = outcome.failuresReset ? 0 : (outcome.failures ?? job.failures);
        return {
          ...job,
          lastRunAt: outcome.lastRunAt,
          lastError: outcome.lastError,
          failures,
          enabled: outcome.disable === true ? false : job.enabled,
        };
      }),
    ),
  );
};

/** Remove every job bound to one of the given sessions (profile purge cascade). */
export const removeCronJobsForSessions = async (
  mind: MindService,
  sessionIds: readonly string[],
): Promise<number> => {
  const items = await readJobs(mind);
  const bound = new Set(sessionIds);
  const remaining = items.filter((job) => !bound.has(job.sessionId));
  if (remaining.length !== items.length) await Effect.runPromise(writeJobs(mind, remaining));
  return items.length - remaining.length;
};

export interface CronScheduler {
  /** Re-arm every enabled job (after create/remove/toggle). */
  readonly refresh: () => Promise<void>;
  readonly stop: () => void;
}

/** Consecutive failures before a job disables itself and pages the owner. */
const MAX_CONSECUTIVE_FAILURES = 3;

const armedJob = (mind: MindService, job: CronJobInfo, scheduler: CronScheduler): Cron => {
  const fire = async (): Promise<void> => {
    try {
      await deliverToSession(mind, job.sessionId, `[cron ${job.id}] ${job.prompt}`);
      await setJobOutcome(mind, job.id, {
        lastRunAt: Date.now(),
        lastError: null,
        failuresReset: true,
      });
    } catch (cause) {
      const failures = job.failures + 1;
      const error = String(cause).slice(0, 300);
      const disable = failures >= MAX_CONSECUTIVE_FAILURES;
      await setJobOutcome(mind, job.id, {
        lastRunAt: Date.now(),
        lastError: error,
        failures,
        ...(disable ? { disable } : {}),
      });
      if (disable) {
        // The attention path: silence must eventually page the owner.
        mind.audit.record({
          at: Date.now(),
          kind: "escalation",
          conversationId: "cron",
          profile: job.profile,
          callId: job.id,
          name: "cron-disabled",
          durationMs: null,
          ok: false,
          error: `${MAX_CONSECUTIVE_FAILURES} consecutive failures: ${error}`,
        });
        console.error(`cron ${job.id} disabled after ${failures} consecutive failures`);
      }
    }
  };
  // Schedules render in the profile's timezone ("morning" means the owner's morning).
  const timezoneOf = async (): Promise<string | undefined> => {
    const row = await mind.profiles.rowOf(job.sessionId);
    const profile = row !== undefined ? await mind.profiles.get(row.owner, job.profile) : undefined;
    return profile?.timezone;
  };
  let timer: Cron | undefined;
  const arm = (): void => {
    void timezoneOf().then((timezone) => {
      timer = new Cron(
        job.schedule,
        { paused: !job.enabled, ...(timezone !== undefined ? { timezone } : {}) },
        () => {
          void fire().finally(() => void scheduler.refresh());
        },
      );
    });
  };
  arm();
  // A thin stop-capable stand-in: the scheduler only ever calls stop().
  return { stop: () => timer?.stop() } as unknown as Cron;
};

/** Arm the scheduler over every registered job; refresh after registry changes. */
export const startScheduler = async (mind: MindService): Promise<CronScheduler> => {
  const timers = new Map<string, Cron>();
  const refresh = async (): Promise<void> => {
    for (const timer of timers.values()) timer.stop();
    timers.clear();
    for (const job of await readJobs(mind)) {
      if (!isValidSchedule(job.schedule)) continue;
      timers.set(job.id, armedJob(mind, job, scheduler));
    }
  };
  const scheduler: CronScheduler = {
    refresh: () => refresh(),
    stop: () => {
      for (const timer of timers.values()) timer.stop();
      timers.clear();
    },
  };
  await refresh();
  return scheduler;
};
