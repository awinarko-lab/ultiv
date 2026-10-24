import { Type } from "typebox";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { requestApproval } from "../approvals.ts";
import { jevClient, jevPick, jevYesNo } from "./typesafe.ts";

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
        output: [{ type: "text", text: `probability: ${probability}` }],
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
        output: [{ type: "text", text: `choice: ${picked}` }],
        structuredOutput: { choice: picked },
      };
    },
  };
}
