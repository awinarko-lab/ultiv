// Live verification for both AI providers (network + keys required).
// LLM calls go through the pi-durable harness — the same path the app uses.
// Run: pnpm --filter @ultiv/server exec node --env-file=../../.env src/ai/probe.ts
import { AssistantEntry, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { defaultAgent, jevExtension } from "./agent.ts";
import { kenariProvider } from "./kenari.ts";
import { jevClient, jevYesNo } from "./typesafe.ts";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.map((b) => String((b as { text?: string }).text ?? "")).join("");
  return JSON.stringify(content);
}

// 1) Kenari through the durable harness: submit → wait → commit.
const models = createModels();
models.setProvider(kenariProvider());
const registry = createRegistry();
const jevExt = jevExtension();
if (jevExt !== undefined) registry.install(jevExt);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, BACKGROUND_CONTEXT);

const started = Date.now();
const root = await harness.root(BACKGROUND_CONTEXT, { agent: defaultAgent() });
const submission = await root.submit(
  {
    type: "input",
    content:
      'Reply with strict JSON only, no prose: {"ok":true,"model_used":string} where model_used is your model id.',
  },
  BACKGROUND_CONTEXT,
);
const settled = await submission.wait(BACKGROUND_CONTEXT);
if (settled.status !== "done" || settled.type !== "input") {
  throw new Error(`kenari unanswered: ${JSON.stringify(settled).slice(0, 300)}`);
}
// AssistantEntry contract: `model` is `[AssistantMessage]`, written by generation.
const stored = await root.commit(
  (tx) => tx.entry(AssistantEntry, settled.answer),
  BACKGROUND_CONTEXT,
);
const message = stored?.model?.[0] as { content?: unknown } | undefined;
const latency = Date.now() - started;
const text = textOf(message?.content)
  .trim()
  .replace(/^```json\s*|```$/g, "");
console.log(`kenari (harness): latency=${latency}ms`);
console.log("kenari:", text.slice(0, 200));
JSON.parse(text); // throws if the model wrapped or truncated the JSON

// 1b) Jev as a native harness tool: the agent scores through jev_score.
const toolSubmission = await root.submit(
  {
    type: "input",
    content:
      'Use the jev_score tool on the statement "The sky is typically blue." with the instruction "Is the statement true?" Then reply with just the probability as a bare number.',
  },
  BACKGROUND_CONTEXT,
);
const toolSettled = await toolSubmission.wait(BACKGROUND_CONTEXT);
if (toolSettled.status !== "done" || toolSettled.type !== "input") {
  throw new Error(`tool turn failed: ${JSON.stringify(toolSettled).slice(0, 300)}`);
}
const toolStored = await root.commit(
  (tx) => tx.entry(AssistantEntry, toolSettled.answer),
  BACKGROUND_CONTEXT,
);
const toolMessage = toolStored?.model?.[0] as { content?: unknown } | undefined;
const toolText = textOf(toolMessage?.content).trim();
const match = toolText.match(/(\d+(?:\.\d+)?)/);
const probability = match === null ? Number.NaN : Number.parseFloat(match[1] ?? "");
console.log(`jev via jev_score tool: reply="${toolText.slice(0, 80)}" -> ${probability}`);
if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
  throw new Error("jev tool path failed: no probability in reply");
}
await harness.close(BACKGROUND_CONTEXT);

// 2) Typesafe.AI (Jev) — typed yes/no decision with a sanity bound.
const jev = jevClient();
const p = await jevYesNo(
  jev,
  "A clear-sky day typically has a blue sky.",
  "Is the statement true?",
);
console.log(`jev yes-probability: ${p}`);
if (!(p > 0.5)) throw new Error("jev sanity check failed");
console.log("probe ok");
