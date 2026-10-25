import { describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";
import { defineDoc, MemoryStorage } from "@earendil-works/pi-durable";
import { openMind } from "../entity.ts";

const TestDoc = defineDoc<{ items: string[] }>({
  kind: "ultiv.test-doc",
  version: 1,
  scope: "session",
  initial: () => ({ items: [] }),
  checkpointWhen: () => true,
});

describe("Converse (offline, MemoryStorage)", () => {
  it("maps an app key to one durable conversation and commits docs", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const chat = await Effect.runPromise(handle.mind.converse.ensure("session-1"));
    const again = await Effect.runPromise(handle.mind.converse.ensure("session-1"));
    expect(String(again.id)).toBe(String(chat.id));
    const fresh = await Effect.runPromise(handle.mind.converse.ensure("session-2"));
    expect(String(fresh.id)).not.toBe(String(chat.id));
    await Effect.runPromise(
      handle.mind.converse.docs.commit(async (tx) => {
        const draft = await tx.doc(TestDoc);
        draft.items = [...draft.items, "one"];
      }),
    );
    const snapshot = await Effect.runPromise(handle.mind.converse.docs.snapshot(TestDoc));
    expect(snapshot?.items).toEqual(["one"]);
    const described = handle.mind.describe();
    expect(described.entity).toBe("mind");
    expect(described.decide).toBe(false); // no TYPESAFE_API_KEY in tests
    await handle.close();
  });
});
