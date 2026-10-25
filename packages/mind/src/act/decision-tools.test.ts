import { describe, expect, it } from "vite-plus/test";
import type { JevGateway } from "../decide/gateway.ts";
import { decideService } from "../decide/decide.ts";
import { decisionTools } from "./decision-tools.ts";
import { specsOf } from "./decision-ask.ts";

const fakeGateway: JevGateway = {
  systemOne: (request) => {
    const answers: Record<string, unknown> = {};
    for (const [name, question] of Object.entries(request.questions)) {
      const kind = (question as { type?: string }).type;
      if (kind === "noul") answers[name] = { type: "noul", noul: 0.75 };
      else answers[name] = { type: "choice", choice: "b", confidence: 0.9 };
    }
    return Promise.resolve({ answers } as never);
  },
};

describe("decision tools", () => {
  it("builds validated specs from flat args", () => {
    expect(specsOf([{ name: "x", type: "noul", instruction: "is it?" }])).toEqual([
      { name: "x", type: "noul", instructions: "is it?" },
    ]);
    expect(() => specsOf([{ name: "x", type: "noul" }])).toThrow("needs an instruction");
    expect(() => specsOf([{ name: "x", type: "choice", instruction: "which?" }])).toThrow(
      "needs an instruction and options",
    );
    expect(() => specsOf([{ name: "x", type: "score" }])).toThrow("needs a rubric");
  });

  it("expose the four Jev tools as reads (never gated)", () => {
    const decide = decideService(fakeGateway);
    expect(decisionTools(decide).map((tool) => tool.name)).toEqual([
      "jev_score",
      "jev_pick",
      "jev_rate",
      "jev",
    ]);
    expect(decisionTools(decide).every((tool) => tool.gated !== true)).toBe(true);
  });

  it("run through the Decide faculty", async () => {
    const decide = decideService(fakeGateway);
    const [score, pick] = decisionTools(decide);
    if (score === undefined || pick === undefined) throw new Error("missing tools");
    const scored = await score.execute(
      { statement: "s", instruction: "i" },
      {} as never,
      {} as never,
    );
    expect(scored.structuredOutput).toEqual({ probability: 0.75 });
    const picked = await pick.execute(
      { question: "which?", options: ["a", "b"] },
      {} as never,
      {} as never,
    );
    expect(picked.structuredOutput).toEqual({ choice: "b" });
  });
});
