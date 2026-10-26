/**
 * The sensor poll loop: the server half of the sensors faculty. On each tick
 * it fetches the calendar ICS feed once, and for every enabled sensor wakes
 * on matching events entering their lead window. Dedup is by the FEED'S OWN
 * event uid (stored in a ring on the sensor row) — a natural key from the
 * source, so each real-world event wakes exactly once, across restarts.
 * Sensors are low-priority wakes: they queue as follow-ups, never steering a
 * turn in flight.
 */
import type { MindService } from "@ultiv/mind";
import {
  listSensors,
  recordRoutineFire,
  readSensors,
  recordSensorFire,
  settleRoutineEvent,
  updateSensor,
} from "@ultiv/mind";
import { calendarFeedUrl, parseIcs, type IcsEvent } from "@ultiv/ext";
import { deliverToSession } from "./deliver.ts";

const POLL_MS = Number(process.env.SENSOR_POLL_MS ?? 300_000);
/** A fire window stays open briefly past the start, so one missed poll isn't a lost wake. */
const GRACE_MS = 60 * 60 * 1000;

export interface SensorLoop {
  readonly stop: () => void;
  /** One immediate pass (used after sensor changes and by tests). */
  readonly poll: () => Promise<void>;
}

const matching = (sensor: { match: string }, event: IcsEvent): boolean =>
  sensor.match === "" || event.summary.toLowerCase().includes(sensor.match.toLowerCase());

const sensorPass = async (mind: MindService): Promise<void> => {
  const feedUrl = calendarFeedUrl();
  const sensors = await readSensors(mind.converse);
  const enabled = sensors.filter((sensor) => sensor.enabled);
  if (feedUrl === null) {
    for (const sensor of enabled) {
      if (sensor.lastError !== "calendar feed not configured") {
        await updateSensor(mind.converse, sensor.id, (row) => ({
          ...row,
          lastError: "calendar feed not configured",
        }));
      }
    }
    return;
  }
  let events: readonly IcsEvent[];
  try {
    const response = await fetch(feedUrl, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`feed returned ${response.status}`);
    events = parseIcs(await response.text());
  } catch (cause) {
    const error = String(cause).slice(0, 200);
    for (const sensor of enabled) {
      await updateSensor(mind.converse, sensor.id, (row) => ({ ...row, lastError: error }));
    }
    return;
  }
  const now = Date.now();
  for (const sensor of enabled) {
    const due = events.filter(
      (event) =>
        matching(sensor, event) &&
        !(sensor.seen ?? []).includes(event.uid ?? `${event.summary}@${event.start}`) &&
        now >= event.start - sensor.leadMinutes * 60_000 &&
        now <= event.start + GRACE_MS,
    );
    await updateSensor(mind.converse, sensor.id, (row) => ({
      ...row,
      lastPollAt: now,
      lastError: null,
    }));
    for (const event of due) {
      const uid = event.uid ?? `${event.summary}@${event.start}`;
      // WRITE-AHEAD receipt, then the wake, then the dedup ring — a crash
      // between receipt and ring re-fires (at-least-once, visible in receipts).
      const eventId = await recordRoutineFire(mind.converse, {
        routineId: sensor.id,
        source: "sensor",
        deliveryId: `${sensor.id}:${uid}`,
      });
      try {
        const at = new Date(event.start).toISOString();
        await deliverToSession(
          mind,
          sensor.sessionId,
          `[sensor ${sensor.id}] calendar: "${event.summary}" starts at ${at}` +
            (event.location !== null ? ` (${event.location})` : ""),
          "followUp",
        );
        await settleRoutineEvent(mind.converse, eventId, "delivered");
        await recordSensorFire(mind.converse, sensor.id, uid);
      } catch (cause) {
        await settleRoutineEvent(mind.converse, eventId, "failed", String(cause).slice(0, 300));
      }
    }
  }
};

/** Arm the poll loop; refresh is unnecessary — sensors are read fresh each tick. */
export const startSensorLoop = async (mind: MindService): Promise<SensorLoop> => {
  const timer = setInterval(() => {
    void sensorPass(mind).catch((cause) => {
      console.error("sensor poll failed:", String(cause).slice(0, 200));
    });
  }, POLL_MS);
  timer.unref?.();
  await sensorPass(mind).catch((cause) => {
    console.error("sensor poll failed:", String(cause).slice(0, 200));
  });
  return {
    stop: () => clearInterval(timer),
    poll: () => sensorPass(mind),
  };
};
