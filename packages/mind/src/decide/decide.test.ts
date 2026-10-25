import { describe, expect, it } from "vite-plus/test";
import { Effect, Exit } from "effect";
import type { JevGateway } from "./gateway.ts";
import { decideService, type DecideError } from "./decide.ts";

/** Canned gateway: answers keyed by the question builder's primitive. */
const fakeGateway = (noul: number): JevGateway => ({
  systemOne: (request) => {
    const answers: Record<string, unknown> = {};
    for (const [name, question] of Object.entries(request.questions)) {
      const kind = (question as { type?: string }).type;
      if (kind === "noul") answers[name] = { type: "noul", noul };
      else if (kind === "choice") answers[name] = { type: "choice", choice: "b", confidence: 0.8 };
      else
        answers[name] = {
          type: "score",
          score: 1.5,
          confidence: 0.7,
          probabilities: { a: 0.25, b: 0.75 },
        };
    }
    return Promise.resolve({ answers } as never);
  },
});

const run = <A>(effect: Effect.Effect<A, DecideError>): Promise<A> => Effect.runPromise(effect);

describe("Decide", () => {
  it("is unavailable without a gateway", async () => {
    const decide = decideService(undefined);
    expect(decide.available).toBe(false);
    const exit = await Effect.runPromiseExit(decide.yesNo("state", "is it?"));
    expect(Exit.isSuccess(exit)).toBe(false);
  });

  it("maps yesNo, pick, and rate", async () => {
    const decide = decideService(fakeGateway(0.9));
    expect(decide.available).toBe(true);
    expect(await run(decide.yesNo("state", "is it?"))).toBe(0.9);
    expect(await run(decide.pick("which?", ["a", "b", "c"]))).toBe("b");
    const rated = await run(decide.rate("state", "rate it", ["low", "high"]));
    expect(rated).toEqual({ score: 1.5, confidence: 0.7, probabilities: { a: 0.25, b: 0.75 } });
  });

  it("answers ask() in spec order", async () => {
    const decide = decideService(fakeGateway(0.1));
    const answers = await run(
      decide.ask("state", [
        { name: "yes", type: "noul", instructions: "is it?" },
        { name: "which", type: "choice", instructions: "which?", options: ["a", "b"] },
        { name: "level", type: "score", instructions: null, rubric: ["low", "high"] },
      ]),
    );
    expect(answers.map((answer) => answer.name)).toEqual(["yes", "which", "level"]);
    expect(answers[0]).toMatchObject({ type: "noul", probability: 0.1 });
    expect(answers[1]).toMatchObject({ type: "choice", choice: "b" });
    expect(answers[2]).toMatchObject({ type: "score", score: 1.5 });
  });
});
