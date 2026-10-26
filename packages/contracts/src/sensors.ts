import { Type, type Static } from "typebox";

/**
 * One sensor: a watch on an external source (calendar feeds first) that
 * wakes the entity on events. Dedup rides the SOURCE's natural key (ICS
 * UID), so the harness dedups at the semantic layer — the entity sees each
 * real-world event once.
 */
export const SensorInfoSchema = Type.Object({
  id: Type.String(),
  sessionId: Type.String(),
  profile: Type.String(),
  /** Sensor family; only "calendar" (the owner's ICS feed) exists today. */
  kind: Type.Literal("calendar"),
  /** Case-insensitive substring the event summary must contain; empty matches everything. */
  match: Type.String(),
  /** Wake this many minutes before the event starts. */
  leadMinutes: Type.Number(),
  enabled: Type.Boolean(),
  createdAt: Type.Number(),
  lastPollAt: Type.Union([Type.Number(), Type.Null()]),
  lastError: Type.Union([Type.String(), Type.Null()]),
  fireCount: Type.Number(),
  lastFiredAt: Type.Union([Type.Number(), Type.Null()]),
  /** Dedup ring: recent source event uids already woken on (harness-level semantic dedup). */
  seen: Type.Optional(Type.Array(Type.String())),
});

export type SensorInfo = Static<typeof SensorInfoSchema>;

export const SensorListSchema = Type.Array(SensorInfoSchema);

export type SensorList = Static<typeof SensorListSchema>;
