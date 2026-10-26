import { describe, expect, it } from "vite-plus/test";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { openMind } from "../entity.ts";

describe("Durable state (profile-scoped KV, offline, MemoryStorage)", () => {
  it("survives the writes-then-reads cycle and scopes by profile", async () => {
    const handle = await openMind({ storage: new MemoryStorage() });
    const { state, profiles } = handle.mind;
    const botA = await profiles.create("harry", { name: "A" });
    const botB = await profiles.create("harry", { name: "B" });

    await state.set(botA.id, "ledger/generation", "gen-1");
    await state.set(botA.id, "invoice-42/acted", "true");
    expect(await state.get(botA.id, "ledger/generation")).toBe("gen-1");
    // Profile scoping: B's store is not A's.
    expect(await state.get(botB.id, "ledger/generation")).toBeUndefined();

    const rows = await state.list(botA.id);
    expect(rows.map((r) => r.key)).toEqual(["ledger/generation", "invoice-42/acted"]);
    expect(rows[0]?.updatedAt).toBeGreaterThan(0);

    expect(await state.delete(botA.id, "invoice-42/acted")).toBe(true);
    expect(await state.delete(botA.id, "invoice-42/acted")).toBe(false);
    expect(await state.get(botA.id, "invoice-42/acted")).toBeUndefined();
    await handle.close();
  });
});
