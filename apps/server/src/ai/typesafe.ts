import {
  noul,
  TypeSafeClient,
  type EntryType,
  type Questions,
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
