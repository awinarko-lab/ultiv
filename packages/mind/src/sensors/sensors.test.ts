import { describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { openMind } from "../entity.ts";
import { readSensors, recordSensorFire } from "./sensors.ts";
import { sensorTools } from "./tools.ts";

describe("Sensors faculty (offline, MemoryStorage)", () => {
  it("creates, lists and removes sensors with lead-time clamping", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { mind } = handle;
    const { converse, profiles, sensors } = mind;
    const bot = await profiles.create("harry", { name: "Edison" });
    const main = await profiles.ensureMain("harry", bot.id);

    const created = await sensors.create({ sessionId: main.id, match: "standup" });
    expect(created.kind).toBe("calendar");
    expect(created.match).toBe("standup");
    expect(created.leadMinutes).toBe(10);
    const clamped = await sensors.create({ sessionId: main.id, match: "", leadMinutes: 99_999 });
    expect(clamped.leadMinutes).toBe(1440);
    // rss sensors carry their own feed url; a bad one is refused at creation.
    const rss = await sensors.create({
      sessionId: main.id,
      kind: "rss",
      url: "https://example.com/feed.xml",
      match: "release",
    });
    expect(rss.kind).toBe("rss");
    expect(rss.url).toBe("https://example.com/feed.xml");
    await expect(
      sensors.create({ sessionId: main.id, kind: "rss", url: "not-a-url", match: "" }),
    ).rejects.toThrow(/http\(s\)/);

    const listed = await sensors.list();
    expect(listed).toHaveLength(3);

    // The dedup ring: recording a fire marks the uid seen for next polls.
    await recordSensorFire(converse, created.id, "uid-1");
    const rows = await readSensors(converse);
    expect(rows.find((r) => r.id === created.id)?.seen).toEqual(["uid-1"]);
    expect(rows.find((r) => r.id === created.id)?.fireCount).toBe(1);

    expect(await sensors.remove(created.id)).toBe(true);
    expect(await sensors.remove(created.id)).toBe(false);
    await handle.close();
  });

  it("exposes set/list/remove as tools scoped to the profile", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { converse, profiles, sensors } = handle.mind;
    const bot = await profiles.create("harry", { name: "Edison" });
    const main = await profiles.ensureMain("harry", bot.id);
    const key = await profiles.keyForSession("harry", main.id);
    const conversation = await Effect.runPromise(converse.ensure(key));
    const api = { conversationId: String(conversation.id) } as never;

    const [set, list, remove] = sensorTools(sensors, profiles);
    if (set === undefined || list === undefined || remove === undefined) {
      throw new Error("missing sensor tools");
    }
    const created = await set.execute({ match: "1:1", leadMinutes: 15 }, api, {} as never);
    expect(created.isError).toBeUndefined();
    const id = (created.structuredOutput as { id: string }).id;

    const listed = await list.execute({}, api, {} as never);
    expect((listed.structuredOutput as { id: string }[]).map((s) => s.id)).toEqual([id]);

    const removed = await remove.execute({ id }, api, {} as never);
    expect((removed.structuredOutput as { removed: boolean }).removed).toBe(true);
    const stranger = await remove.execute({ id }, api, {} as never);
    expect(stranger.isError).toBe(true);
    await handle.close();
  });
});
