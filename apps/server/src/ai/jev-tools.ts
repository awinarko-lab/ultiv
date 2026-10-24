import { Type } from "typebox";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { requestApproval } from "../approvals.ts";
import { jevAsk, jevClient, jevPick, jevRate, jevYesNo, type JevQuestionSpec } from "./typesafe.ts";

const ScoreParams = Type.Object({
  statement: Type.String({ description: "The claim or situation to judge." }),
  instruction: Type.String({
    description: "What to decide about it, phrased as a yes/no question.",
  }),
});

/** Jev probability (0..1) that the statement holds under the instruction. */
export function jevScoreTool(): ToolRegistration<typeof ScoreParams> {
  return {
    name: "jev_score",
    description:
      "Ask Jev, a typed decision model, for the probability (0..1) that a statement holds. Prefer this over guessing for yes/no judgments.",
    parameters: ScoreParams,
    structuredOutputSchema: Type.Object({ probability: Type.Number() }),
    execute: async (args) => {
      const probability = await jevYesNo(jevClient(), args.statement, args.instruction);
      return {
        output: [{ type: "text", text: String(probability) }],
        structuredOutput: { probability },
      };
    },
  };
}

const PickParams = Type.Object({
  question: Type.String({ description: "What to decide, phrased as a question." }),
  options: Type.Array(Type.String(), {
    minItems: 2,
    description: "The allowed answers.",
  }),
});

/** Jev picks exactly one of the given options for the question. */
export function jevPickTool(): ToolRegistration<typeof PickParams> {
  return {
    name: "jev_pick",
    description:
      "Ask Jev, a typed decision model, to pick exactly one of the given options for a question.",
    parameters: PickParams,
    structuredOutputSchema: Type.Object({ choice: Type.String() }),
    execute: async (args, api) => {
      // Gated: jev_pick spends a decision on the user's behalf — wait for approval.
      const approved = await requestApproval(String(api.conversationId), api.callId, {
        callId: api.callId,
        name: "jev_pick",
        input: args,
      });
      if (!approved) {
        return {
          isError: true,
          output: [{ type: "text", text: "denied by the user" }],
        };
      }
      const picked = await jevPick(jevClient(), args.question, args.options);
      return {
        output: [{ type: "text", text: picked }],
        structuredOutput: { choice: picked },
      };
    },
  };
}

const RatingOutput = Type.Object({
  score: Type.Number(),
  confidence: Type.Number(),
  probabilities: Type.Record(Type.String(), Type.Number()),
});

const RateParams = Type.Object({
  state: Type.String({ description: "The thing to rate." }),
  rubric: Type.Array(Type.String(), {
    minItems: 2,
    description: "Ordered level descriptions; the index is the score (0 = first level).",
  }),
  instruction: Type.String({ description: "What to rate the state for." }),
});

/** Jev rates the state against an ordered rubric; the expected score may be fractional. */
export function jevRateTool(): ToolRegistration<typeof RateParams> {
  return {
    name: "jev_rate",
    description:
      "Ask Jev, a typed decision model, to rate a state against an ordered rubric. Returns the expected score (may fall between levels) with a confidence.",
    parameters: RateParams,
    structuredOutputSchema: RatingOutput,
    execute: async (args) => {
      const rated = await jevRate(jevClient(), args.state, args.instruction, args.rubric);
      return {
        output: [{ type: "text", text: `${rated.score} (confidence ${rated.confidence})` }],
        structuredOutput: rated,
      };
    },
  };
}

const QuestionParams = Type.Object({
  name: Type.String({ description: "Key this answer is reported under." }),
  type: Type.Union([Type.Literal("noul"), Type.Literal("choice"), Type.Literal("score")], {
    description: "noul = yes/no probability, choice = pick one of options, score = rubric rating.",
  }),
  instruction: Type.Optional(Type.String({ description: "What to decide for this question." })),
  options: Type.Optional(
    Type.Array(Type.String(), { minItems: 2, description: "choice only: the allowed answers." }),
  ),
  rubric: Type.Optional(
    Type.Array(Type.String(), {
      minItems: 2,
      description: "score only: ordered level descriptions, index = score.",
    }),
  ),
});

const AskParams = Type.Object({
  state: Type.String({ description: "The subject all questions judge." }),
  questions: Type.Array(QuestionParams, {
    minItems: 1,
    maxItems: 8,
    description: "One entry per decision; noul/score need an instruction, choice needs options.",
  }),
});

/** Build validated specs from the flat tool args; throws a model-readable error when malformed. */
function specsOf(
  questions: ReadonlyArray<{
    name: string;
    type: string;
    instruction?: string;
    options?: readonly string[];
    rubric?: readonly string[];
  }>,
): JevQuestionSpec[] {
  return questions.map((question) => {
    if (question.type === "noul") {
      if (question.instruction === undefined) {
        throw new Error(`${question.name}: noul needs an instruction (phrased as yes/no).`);
      }
      return { name: question.name, type: "noul", instructions: question.instruction };
    }
    if (question.type === "choice") {
      if (question.instruction === undefined || question.options === undefined) {
        throw new Error(`${question.name}: choice needs an instruction and options.`);
      }
      return {
        name: question.name,
        type: "choice",
        instructions: question.instruction,
        options: question.options,
      };
    }
    if (question.rubric === undefined) {
      throw new Error(`${question.name}: score needs a rubric (at least two levels).`);
    }
    return {
      name: question.name,
      type: "score",
      instructions: question.instruction ?? null,
      rubric: question.rubric,
    };
  });
}

const AskOutput = Type.Object({
  answers: Type.Array(
    Type.Union([
      Type.Object({
        name: Type.String(),
        type: Type.Literal("noul"),
        probability: Type.Number(),
      }),
      Type.Object({
        name: Type.String(),
        type: Type.Literal("choice"),
        choice: Type.String(),
        confidence: Type.Number(),
      }),
      Type.Object({
        name: Type.String(),
        type: Type.Literal("score"),
        score: Type.Number(),
        confidence: Type.Number(),
        probabilities: Type.Record(Type.String(), Type.Number()),
      }),
    ]),
  ),
});

function lineOf(answer: {
  name: string;
  type: string;
  probability?: number;
  choice?: string;
  score?: number;
  confidence?: number;
}): string {
  if (answer.type === "noul") return `${answer.name}: ${answer.probability}`;
  if (answer.type === "choice") return `${answer.name}: ${answer.choice}`;
  return `${answer.name}: ${answer.score} (confidence ${answer.confidence})`;
}

/** Ask several typed questions (any primitive except box) to Jev in ONE call. */
export function jevAskTool(): ToolRegistration<typeof AskParams> {
  return {
    name: "jev",
    description:
      "Ask Jev, a typed decision model, several questions in one call. Each question is a noul (yes/no probability), choice (pick one of options — acts for the user, needs approval), or score (rubric rating). Batch related decisions here instead of many single calls.",
    parameters: AskParams,
    structuredOutputSchema: AskOutput,
    execute: async (args, api) => {
      const specs = specsOf(args.questions);
      if (specs.some((spec) => spec.type === "choice")) {
        // A choice decides on the user's behalf — same gate as jev_pick, once per batch.
        const approved = await requestApproval(String(api.conversationId), api.callId, {
          callId: api.callId,
          name: "jev",
          input: args,
        });
        if (!approved) {
          return {
            isError: true,
            output: [{ type: "text", text: "denied by the user" }],
          };
        }
      }
      const answers = await jevAsk(jevClient(), args.state, specs);
      return {
        output: [{ type: "text", text: answers.map(lineOf).join("\n") }],
        structuredOutput: { answers },
      };
    },
  };
}
