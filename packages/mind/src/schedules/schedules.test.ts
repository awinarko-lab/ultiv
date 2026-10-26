import { describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { openMind } from "../entity.ts";
import { isValidJobStart, isValidSchedule, schedulesService } from "./schedules.ts";
import { scheduleTools } from "./tools.ts";

describe("Schedules faculty (offline, MemoryStorage)", () => {
  it("validates cron expressions and future one-shots", () => {
    expect(isValidSchedule("30 9 * * 1")).toBe(true);
    expect(isValidSchedule("nope")).toBe(false);
    expect(isValidJobStart("", Date.now() + 60_000)).toBe(true);
    expect(isValidJobStart("", Date.now() - 1000)).toBe(false);
    expect(isValidJobStart("bad * *", null)).toBe(false);
    expect(isValidJobStart("30 9 * * 1", null)).toBe(true);
  });

  it("creates, lists and removes one-shot and cron jobs via tools", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { mind } = handle;
    const { converse, profiles, schedules } = mind;
    const bot = await profiles.create("harry", { name: "Edison" });
    const main = await profiles.ensureMain("harry", bot.id);
    const key = await profiles.keyForSession("harry", main.id);
    const conversation = await Effect.runPromise(converse.ensure(key));
    const conversationId = String(conversation.id);

    const [set, list, remove] = scheduleTools(schedules, profiles);
    if (set === undefined || list === undefined || remove === undefined) {
      throw new Error("missing schedule tools");
    }
    const api = { conversationId } as never;

    const once = await set.execute(
      { prompt: "check the build", once: Date.now() + 600_000 },
      api,
      {} as never,
    );
    expect(once.isError).toBeUndefined();
    const onceId = (once.structuredOutput as { id: string }).id;

    const cron = await set.execute({ prompt: "standup", schedule: "30 9 * * 1" }, api, {} as never);
    expect(cron.isError).toBeUndefined();

    const listed = await list.execute({}, api, {} as never);
    expect(listed.structuredOutput).toHaveLength(2);

    const bad = await set.execute({ prompt: "x", once: Date.now() - 1000 }, api, {} as never);
    expect(bad.isError).toBe(true);
    const badCron = await set.execute({ prompt: "x", schedule: "nope" }, api, {} as never);
    expect(badCron.isError).toBe(true);

    const gone = await remove.execute({ id: onceId }, api, {} as never);
    expect((gone.structuredOutput as { removed: boolean }).removed).toBe(true);
    const stranger = await remove.execute({ id: "nope" }, api, {} as never);
    expect(stranger.isError).toBe(true);

    const after = await schedules.list();
    expect(after).toHaveLength(1);
    expect(after[0]?.schedule).toBe("30 9 * * 1");
    await handle.close();
  });

  it("refuses conversations without a profile scope", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { mind } = handle;
    const conversation = await Effect.runPromise(mind.converse.root());
    const [set] = scheduleTools(mind.schedules, mind.profiles);
    if (set === undefined) throw new Error("missing schedule tools");
    const refused = await set.execute(
      { prompt: "x", schedule: "30 9 * * 1" },
      { conversationId: String(conversation.id) } as never,
      {} as never,
    );
    expect(refused.isError).toBe(true);
    await handle.close();
  });

  it("notifies onChanged so a live scheduler can re-arm", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { converse, profiles } = handle.mind;
    const bot = await profiles.create("harry", { name: "Edison" });
    let changes = 0;
    const schedules = schedulesService({
      converse,
      profiles,
      onChanged: () => {
        changes += 1;
        return Promise.resolve();
      },
    });
    const main = await profiles.ensureMain("harry", bot.id);
    await schedules.create({
      sessionId: main.id,
      schedule: "",
      once: Date.now() + 600_000,
      prompt: "ping",
    });
    await schedules.remove((await schedules.list())[0]?.id ?? "");
    expect(changes).toBe(2);
    await handle.close();
  });
});
