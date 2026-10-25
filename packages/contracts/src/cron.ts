import { Type, type Static } from "typebox";

/** One cron trigger: a schedule that delivers a prompt into a session. */
export const CronJobInfoSchema = Type.Object({
  id: Type.String(),
  sessionId: Type.String(),
  /** 5-field cron expression in the server's timezone. */
  schedule: Type.String(),
  prompt: Type.String(),
  enabled: Type.Boolean(),
  createdAt: Type.Number(),
  lastRunAt: Type.Union([Type.Number(), Type.Null()]),
  lastError: Type.Union([Type.String(), Type.Null()]),
});

export type CronJobInfo = Static<typeof CronJobInfoSchema>;

export const CronJobListSchema = Type.Array(CronJobInfoSchema);

export type CronJobList = Static<typeof CronJobListSchema>;
