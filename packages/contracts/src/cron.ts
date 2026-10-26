import { Type, type Static } from "typebox";

/** One cron trigger: a schedule that delivers a prompt into a session. */
export const CronJobInfoSchema = Type.Object({
  id: Type.String(),
  sessionId: Type.String(),
  /** The profile whose timezone this schedule renders in. */
  profile: Type.String(),
  /** 5-field cron expression, interpreted in the profile's timezone. Empty for one-shot jobs. */
  schedule: Type.String(),
  /** One-shot epoch ms trigger; fires once, then the job removes itself. Null for recurring. */
  once: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  prompt: Type.String(),
  enabled: Type.Boolean(),
  /** Consecutive delivery failures; 3 auto-disables the job. */
  failures: Type.Number(),
  createdAt: Type.Number(),
  lastRunAt: Type.Union([Type.Number(), Type.Null()]),
  lastError: Type.Union([Type.String(), Type.Null()]),
});

export type CronJobInfo = Static<typeof CronJobInfoSchema>;

export const CronJobListSchema = Type.Array(CronJobInfoSchema);

export type CronJobList = Static<typeof CronJobListSchema>;
