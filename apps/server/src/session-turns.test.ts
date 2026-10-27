import { describe, expect, it } from "vite-plus/test";
import type { ConversationView } from "@earendil-works/pi-durable";
import { InFlight, queuedOf, sameQueue } from "./session-turns.ts";

const viewWith = (items: unknown[]): ConversationView =>
  ({ entries: [], docs: { "pi.inbox": { items } } }) as unknown as ConversationView;

describe("queuedOf", () => {
  it("mirrors queued inputs oldest first, without writes or attachment blocks", () => {
    const view = viewWith([
      { id: 7, mode: "steer", content: "also check the weather" },
      { id: 8, mode: "write", entry: {} },
      {
        id: 9,
        mode: "followUp",
        content: [{ type: "text", text: "then this\n\nAttached artifacts:\n- artifact a1" }],
      },
    ]);
    expect(queuedOf(view)).toEqual([
      { id: "7", text: "also check the weather", mode: "steer" },
      { id: "9", text: "then this", mode: "followUp" },
    ]);
  });

  it("is empty with no inbox doc", () => {
    expect(queuedOf({ entries: [], docs: {} } as unknown as ConversationView)).toEqual([]);
  });

  it("compares queues by id and mode", () => {
    const a = [{ id: "1", text: "x", mode: "steer" as const }];
    expect(sameQueue(a, [{ ...a[0]! }])).toBe(true);
    expect(sameQueue(a, [])).toBe(false);
    expect(sameQueue(a, [{ ...a[0]!, mode: "followUp" }])).toBe(false);
  });
});

describe("InFlight", () => {
  it("reads idle only once the last input settles", () => {
    const inFlight = new InFlight();
    inFlight.start();
    inFlight.start();
    expect(inFlight.finish()).toBe(false);
    expect(inFlight.finish()).toBe(true);
    // Never negative: a stray finish still reads idle.
    expect(inFlight.finish()).toBe(true);
  });
});
