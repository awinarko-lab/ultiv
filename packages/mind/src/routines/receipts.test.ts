import { describe, expect, it } from "vite-plus/test";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { openMind } from "../entity.ts";
import {
  ROUTINE_EVENT_CAP,
  listRoutineEvents,
  recordRoutineFire,
  rejectsLast24h,
  settleRoutineEvent,
} from "./receipts.ts";

describe("Routine fire receipts (offline, MemoryStorage)", () => {
  it("records write-ahead, settles outcomes, and answers rejects-last-24h", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { converse } = handle.mind;

    // The write-ahead invariant: the receipt exists (status accepted) BEFORE
    // the delivery is attempted, so a crash leaves a visible incomplete pair.
    const fireId = await recordRoutineFire(converse, {
      routineId: "hook-1",
      source: "webhook",
    });
    const pending = await listRoutineEvents(converse, { routineId: "hook-1" });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe("accepted");
    expect(pending[0]?.deliveryId).toBe(fireId);

    await settleRoutineEvent(converse, fireId, "delivered");
    await settleRoutineEvent(converse, fireId, "delivered"); // idempotent settle
    const settled = (await listRoutineEvents(converse))[0];
    expect(settled?.status).toBe("delivered");

    const rejectId = await recordRoutineFire(converse, {
      routineId: "hook-1",
      source: "webhook",
      reason: "auth",
    });
    await settleRoutineEvent(converse, rejectId, "rejected", "auth");
    expect(await rejectsLast24h(converse, "hook-1")).toBe(1);
    expect(await rejectsLast24h(converse, "hook-other")).toBe(0);

    // A receipt stuck in "accepted" is the crash signature — listing shows it.
    await recordRoutineFire(converse, { routineId: "job-9", source: "cron" });
    const stuck = await listRoutineEvents(converse, { source: "cron" });
    expect(stuck).toHaveLength(1);
    expect(stuck[0]?.status).toBe("accepted");
    await handle.close();
  });

  it("bounds the log, oldest receipts falling off", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { converse } = handle.mind;
    for (let i = 0; i < ROUTINE_EVENT_CAP + 20; i += 1) {
      await recordRoutineFire(converse, { routineId: `r-${i}`, source: "cron" });
    }
    const all = await listRoutineEvents(converse, { limit: ROUTINE_EVENT_CAP + 50 });
    expect(all.length).toBe(ROUTINE_EVENT_CAP);
    // Newest first: the very first fire was trimmed away.
    expect(all.some((event) => event.routineId === "r-0")).toBe(false);
    expect(all[0]?.routineId).toBe(`r-${ROUTINE_EVENT_CAP + 19}`);
    await handle.close();
  });
});
