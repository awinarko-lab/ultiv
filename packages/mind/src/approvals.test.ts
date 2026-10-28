import { describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";
import { Duration } from "effect";
import { adjudicationOf, makeApprovals } from "./approvals.ts";

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

  it("tells listeners about gates that wait, never about auto-approved ones", async () => {
    const approvals = makeApprovals();
    const heard: string[] = [];
    const stop = approvals.listen((conversationId, request) =>
      heard.push(`${conversationId}:${request.name}`),
    );
    approvals.setHooks({ autoApprove: (conversationId) => conversationId === "auto" });
    await expect(Effect.runPromise(approvals.request("auto", "c6", REQUEST))).resolves.toBe(true);
    const pending = Effect.runPromise(approvals.request("conv", "c7", REQUEST));
    await Promise.resolve();
    expect(heard).toEqual(["conv:send_message"]);
    approvals.decide("conv", "c7", true);
    await pending;
    stop();
    void Effect.runPromise(approvals.request("conv", "c8", REQUEST));
    await Promise.resolve();
    expect(heard).toHaveLength(1);
  });

  it("an adjudicated approve resolves without parking or paging the owner", async () => {
    const approvals = makeApprovals();
    const heard: string[] = [];
    approvals.listen((_conversationId, request) => heard.push(request.name));
    approvals.setHooks({
      adjudicate: () => Effect.succeed({ approved: true }),
    });
    await expect(Effect.runPromise(approvals.request("conv", "c9", REQUEST))).resolves.toBe(true);
    expect(approvals.pendingFor("conv")).toEqual([]);
    expect(heard).toEqual([]);
  });

  it("an adjudicated deny with a note parks nothing and serves the note once", async () => {
    const approvals = makeApprovals();
    approvals.setHooks({
      adjudicate: (conversationId, request) =>
        request.name === "risky"
          ? Effect.succeed({ approved: false, note: "outside the delegated role" })
          : Effect.succeed({ approved: false }),
    });
    await expect(
      Effect.runPromise(approvals.request("conv", "c10", { ...REQUEST, name: "risky" })),
    ).resolves.toBe(false);
    expect(approvals.pendingFor("conv")).toEqual([]);
    expect(approvals.noteFor("conv", "c10")).toBe("outside the delegated role");
    expect(approvals.noteFor("conv", "c10")).toBeUndefined();
    // A later deny without a note carries no stale note.
    await expect(Effect.runPromise(approvals.request("conv", "c11", REQUEST))).resolves.toBe(false);
    expect(approvals.noteFor("conv", "c11")).toBeUndefined();
  });

  it("no verdict (undefined) and a failing hook both fall through to the owner", async () => {
    const approvals = makeApprovals();
    let failing = false;
    approvals.setHooks({
      adjudicate: () =>
        failing ? Effect.fail(new Error("judge down")) : Effect.succeed(undefined),
    });
    const undecided = Effect.runPromise(approvals.request("conv", "c12", REQUEST));
    await Promise.resolve();
    expect(approvals.pendingFor("conv")).toEqual([REQUEST]);
    approvals.decide("conv", "c12", true);
    await expect(undecided).resolves.toBe(true);

    failing = true;
    const fellThrough = Effect.runPromise(approvals.request("conv", "c13", REQUEST));
    await Promise.resolve();
    expect(approvals.pendingFor("conv")).toEqual([REQUEST]);
    approvals.decide("conv", "c13", false);
    await expect(fellThrough).resolves.toBe(false);
  });

  it("adjudicationOf: the pure gate thresholds", () => {
    // 'manual' and an unavailable faculty are always the owner's call.
    expect(adjudicationOf("manual", true, 0.99)).toBe("human");
    expect(adjudicationOf("jev", false, 0.99)).toBe("human");
    expect(adjudicationOf("yolo", true, 0.99)).toBe("human");
    // 'jev' with a live faculty: sure approves, doubtful denies, middle defers.
    expect(adjudicationOf("jev", true, 0.95)).toBe("approve");
    expect(adjudicationOf("jev", true, 0.8)).toBe("approve");
    expect(adjudicationOf("jev", true, 0.5)).toBe("human");
    expect(adjudicationOf("jev", true, 0.19)).toBe("deny");
  });
});
