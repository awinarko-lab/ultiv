import { Type, type Static } from "typebox";

/**
 * One sensor: a watch on an external source (calendar feeds and RSS/Atom
 * feeds today) that wakes the entity on events. Dedup rides the SOURCE's
 * natural key (ICS UID, RSS guid / Atom id), so the harness dedups at the
 * semantic layer — the entity sees each real-world event once.
 */
export const SensorInfoSchema = Type.Object({
  id: Type.String(),
  sessionId: Type.String(),
  profile: Type.String(),
  /** "calendar" renders in the owner's ICS feed; "rss" watches its own `url`. */
  kind: Type.Union([Type.Literal("calendar"), Type.Literal("rss")]),
  /** For rss sensors: the feed URL (http/https). Null for calendar. */
  url: Type.Union([Type.String(), Type.Null()]),
  /** Case-insensitive substring the item title must contain; empty matches everything. */
  match: Type.String(),
  /** Calendar sensors: wake this many minutes before the event starts. */
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
