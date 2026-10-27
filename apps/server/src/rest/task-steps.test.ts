import { describe, expect, it } from "vite-plus/test";
import { activitySteps } from "./task-steps.ts";

describe("activitySteps", () => {
  it("keeps tool structure, caps big inputs and outputs", () => {
    const steps = activitySteps([
      { id: 1, kind: "thinking", at: 1, text: "x".repeat(3_000) },
      {
        id: 2,
        kind: "tool",
        at: 2,
        step: {
          callId: "c",
          name: "web_fetch",
          status: "done",
          input: { urls: ["https://a.example/"] },
          output: "y".repeat(5_000),
          durationMs: 40,
        },
      },
      {
        id: 3,
        kind: "tool",
        at: 3,
        step: {
          callId: "d",
          name: "artifact_write",
          status: "running",
          input: { name: "r.md", content: "z".repeat(5_000) },
          output: null,
          durationMs: null,
        },
      },
    ]);
    expect(steps[0]?.text.length).toBe(2_001);
    expect(steps[1]?.tool?.input).toEqual({ urls: ["https://a.example/"] });
    expect(steps[1]?.tool?.output?.length).toBe(4_001);
    expect(steps[1]?.text.startsWith("web_fetch → y")).toBe(true);
    expect(typeof steps[2]?.tool?.input).toBe("string");
    expect(steps[2]?.tool?.status).toBe("running");
    expect(steps[2]?.text).toBe("artifact_write …");
  });

  it("keeps only the tail", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: i,
      kind: "note" as const,
      at: i,
      text: `n${i}`,
    }));
    const steps = activitySteps(many);
    expect(steps).toHaveLength(40);
    expect(steps[0]?.text).toBe("n20");
  });
});
