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
  version: 1,
  scope: "session",
  initial: () => ({ items: [] }),
  checkpointWhen: () => true,
});

const readJobs = async (mind: MindService): Promise<CronJobList> =>
  (await Effect.runPromise(mind.converse.docs.snapshot(CronDoc)))?.items ?? [];

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
  const job: CronJobInfo = {
    id: randomUUID(),
    sessionId: input.sessionId,
    schedule: input.schedule,
    prompt: input.prompt,
    enabled: input.enabled ?? true,
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
  outcome: { lastRunAt: number; lastError: string | null },
): Promise<void> => {
  const items = await readJobs(mind);
  await Effect.runPromise(
    writeJobs(
      mind,
      items.map((job) => (job.id === id ? { ...job, ...outcome } : job)),
    ),
  );
};

export interface CronScheduler {
  /** Re-arm every enabled job (after create/remove/toggle). */
  readonly refresh: () => Promise<void>;
  readonly stop: () => void;
}

const armedJob = (mind: MindService, job: CronJobInfo, scheduler: CronScheduler): Cron => {
  const fire = async (): Promise<void> => {
    try {
      await deliverToSession(mind, job.sessionId, `[cron ${job.id}] ${job.prompt}`);
      await setJobOutcome(mind, job.id, { lastRunAt: Date.now(), lastError: null });
    } catch (cause) {
      await setJobOutcome(mind, job.id, {
        lastRunAt: Date.now(),
        lastError: String(cause).slice(0, 300),
      });
    }
  };
  return new Cron(job.schedule, { paused: !job.enabled }, () => {
    void fire().finally(() => void scheduler.refresh());
  });
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
