import {
  choice,
  noul,
  score,
  TypeSafeClient,
  type ChoiceResponse,
  type EntryType,
  type NoulResponse,
  type Question,
  type Questions,
  type ScoreResponse,
  type SystemOneResult,
} from "@typesafe-ai/sdk";

/** Typesafe.AI client (Jev decision model). Key: TYPESAFE_API_KEY. */
export const JEV_FALLBACK_MODEL = "jev-latest";

export function jevModelId(): string {
  return process.env.TYPESAFE_MODEL ?? JEV_FALLBACK_MODEL;
}

export function jevClient(): TypeSafeClient {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not set — add it to .env");
  return new TypeSafeClient({ apiKey, defaultModel: jevModelId() });
}

/** Run typed decisions over a state; answers come back keyed by question name. */
export async function jevDecide<Q extends Questions>(
  client: TypeSafeClient,
  state: NonNullable<EntryType>,
  questions: Q,
): Promise<SystemOneResult<Q>> {
  return client.systemOne({ state, questions });
}

/** Typed yes/no: returns Jev's probability (0..1) that the answer is yes. */
export async function jevYesNo(
  client: TypeSafeClient,
  state: NonNullable<EntryType>,
  instructions: string,
): Promise<number> {
  const result = await client.systemOne({ state, questions: { answer: noul(instructions) } });
  const answer = result.answers.answer;
  if (answer.type !== "noul") throw new Error(`unexpected answer type: ${String(answer.type)}`);
  return answer.noul;
}

/** Typed pick: Jev chooses exactly one of the given options for the question. */
export async function jevPick(
  client: TypeSafeClient,
  question: string,
  options: readonly string[],
): Promise<string> {
  const criteria = Object.fromEntries(options.map((option) => [option, option]));
  const result = await client.systemOne({
    state: question,
    questions: { answer: choice(question, criteria) },
  });
  const answer = result.answers.answer;
  if (answer.type !== "choice") throw new Error(`unexpected answer type: ${String(answer.type)}`);
  return answer.choice;
}

/** Jev's rubric rating: expected score, confidence, and per-level probabilities. */
export type JevRating = {
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
};

/** Typed rubric score: rate `state` against ordered level descriptions (index = score). */
export async function jevRate(
  client: TypeSafeClient,
  state: NonNullable<EntryType>,
  instructions: string,
  rubric: readonly string[],
): Promise<JevRating> {
  const result = await client.systemOne({
    state,
    questions: { answer: score(instructions, rubric) },
  });
  const answer = result.answers.answer;
  if (answer.type !== "score") throw new Error(`unexpected answer type: ${String(answer.type)}`);
  return {
    score: answer.score,
    confidence: answer.confidence,
    probabilities: { ...answer.probabilities },
  };
}

/** One dynamic `jev` question: a named noul, choice, or score. */
export type JevQuestionSpec =
  | { name: string; type: "noul"; instructions: string }
  | { name: string; type: "choice"; instructions: string; options: readonly string[] }
  | { name: string; type: "score"; instructions: string | null; rubric: readonly string[] };

/** Jev's answer to one dynamic question, tagged with its primitive and the asked name. */
export type JevAnswer =
  | { name: string; type: "noul"; probability: number }
  | { name: string; type: "choice"; choice: string; confidence: number }
  | ({ name: string; type: "score" } & JevRating);

/** Ask several typed questions of any primitive in one Jev call; answers in spec order. */
export async function jevAsk(
  client: TypeSafeClient,
  state: NonNullable<EntryType>,
  specs: readonly JevQuestionSpec[],
): Promise<JevAnswer[]> {
  const questions: Record<string, Question> = {};
  for (const spec of specs) {
    if (spec.type === "noul") {
      questions[spec.name] = noul(spec.instructions);
    } else if (spec.type === "choice") {
      questions[spec.name] = choice(
        spec.instructions,
        Object.fromEntries(spec.options.map((option) => [option, option])),
      );
    } else {
      questions[spec.name] = score(spec.instructions ?? null, spec.rubric);
    }
  }
  const result = await client.systemOne({ state, questions });
  return specs.map((spec) => {
    const answer = result.answers[spec.name] as
      | NoulResponse
      | ChoiceResponse
      | ScoreResponse
      | undefined;
    if (spec.type === "noul") {
      if (answer?.type !== "noul") throw new Error(`unexpected answer for ${spec.name}`);
      return { name: spec.name, type: "noul", probability: answer.noul };
    }
    if (spec.type === "choice") {
      if (answer?.type !== "choice") throw new Error(`unexpected answer for ${spec.name}`);
      return {
        name: spec.name,
        type: "choice",
        choice: answer.choice,
        confidence: answer.confidence,
      };
    }
    if (answer?.type !== "score") throw new Error(`unexpected answer for ${spec.name}`);
    return {
      name: spec.name,
      type: "score",
      score: answer.score,
      confidence: answer.confidence,
      probabilities: { ...answer.probabilities },
    };
  });
}
