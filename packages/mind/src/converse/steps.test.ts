import { describe, expect, it } from "vite-plus/test";
import type { EntryRecord, LiveState } from "@earendil-works/pi-durable";
import { projectTranscript } from "./steps.ts";

const entry = (id: number, messages: readonly unknown[]): EntryRecord =>
  ({ id, model: messages }) as EntryRecord;

describe("projectTranscript", () => {
  it("projects input, output, thinking, and paired tool steps", () => {
    const steps = projectTranscript(
      [
        entry(1, [{ role: "user", content: "hello", timestamp: 100 }]),
        entry(2, [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "pondering" },
              { type: "toolCall", id: "call_1", name: "jev_score", arguments: { a: 1 } },
              { type: "text", text: "done" },
            ],
            timestamp: 200,
          },
        ]),
        entry(3, [
          {
            role: "toolResult",
            toolCallId: "call_1",
            content: "0.9",
            isError: false,
            durationMs: 12,
          },
        ]),
      ],
      undefined,
      false,
    );
    expect(steps.map((step) => step.kind)).toEqual(["input", "thinking", "tool", "output"]);
    const tool = steps[2];
    expect(tool).toMatchObject({
      kind: "tool",
      step: { callId: "call_1", name: "jev_score", status: "done", output: "0.9", durationMs: 12 },
    });
  });

  it("streams the live partial with negative ids and skips settled prefixes", () => {
    const live = {
      generation: { message: { content: [{ type: "text", text: "hel" }], timestamp: 300 } },
    } as LiveState;
    const fresh = projectTranscript([], live, false);
    expect(fresh).toEqual([{ id: -1000, kind: "output", at: 300, text: "hel", streaming: true }]);
    const settled = projectTranscript(
      [
        entry(1, [
          { role: "assistant", content: [{ type: "text", text: "hello" }], timestamp: 200 },
        ]),
      ],
      live,
      false,
    );
    // "hel" is a prefix of the settled "hello": the partial must not duplicate it.
    expect(settled).toHaveLength(1);
  });

  it("marks the newest output streaming while working", () => {
    const steps = projectTranscript(
      [
        entry(1, [
          { role: "assistant", content: [{ type: "text", text: "partial" }], timestamp: 1 },
        ]),
      ],
      undefined,
      true,
    );
    expect(steps[0]).toMatchObject({ kind: "output", text: "partial", streaming: true });
  });
});
