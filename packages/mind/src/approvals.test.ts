import { describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";
import { Duration } from "effect";
import { makeApprovals } from "./approvals.ts";

const REQUEST = { callId: "c1", name: "send_message", input: { to: "x" } };

describe("Approvals", () => {
  it("resolves with the user's decision", async () => {
    const approvals = makeApprovals();
    const pending = Effect.runPromise(approvals.request("conv", "c1", REQUEST));
    await Promise.resolve();
    expect(approvals.pendingFor("conv")).toEqual([REQUEST]);
    approvals.decide("conv", "c1", true);
    await expect(pending).resolves.toBe(true);
    expect(approvals.pendingFor("conv")).toEqual([]);
  });

  it("resolves deny as false", async () => {
    const approvals = makeApprovals();
    const pending = Effect.runPromise(approvals.request("conv", "c2", REQUEST));
    await Promise.resolve();
    approvals.decide("conv", "c2", false);
    await expect(pending).resolves.toBe(false);
  });

  it("denies on timeout and cleans up", async () => {
    const approvals = makeApprovals(Duration.millis(30));
    const approved = await Effect.runPromise(approvals.request("conv", "c3", REQUEST));
    expect(approved).toBe(false);
    expect(approvals.pendingFor("conv")).toEqual([]);
  });

  it("keys pending by conversation", () => {
    const approvals = makeApprovals();
    void Effect.runPromise(approvals.request("a", "c1", REQUEST));
    void Effect.runPromise(approvals.request("b", "c1", REQUEST));
    expect(approvals.pendingFor("a")).toHaveLength(1);
    expect(approvals.pendingFor("b")).toHaveLength(1);
    approvals.decide("a", "c1", true);
    expect(approvals.pendingFor("a")).toEqual([]);
    expect(approvals.pendingFor("b")).toHaveLength(1);
  });

  it("carries a takeover note to the denied tool, consumed on first read", async () => {
    const approvals = makeApprovals();
    const pending = Effect.runPromise(approvals.request("conv", "c4", REQUEST));
    await Promise.resolve();
    approvals.decide("conv", "c4", false, "the owner is handling this themselves");
    await expect(pending).resolves.toBe(false);
    expect(approvals.noteFor("conv", "c4")).toContain("handling this themselves");
    expect(approvals.noteFor("conv", "c4")).toBeUndefined();
    // A plain deny after that carries no stale note.
    const next = Effect.runPromise(approvals.request("conv", "c5", REQUEST));
    await Promise.resolve();
    approvals.decide("conv", "c5", false);
    await expect(next).resolves.toBe(false);
    expect(approvals.noteFor("conv", "c5")).toBeUndefined();
  });
});
