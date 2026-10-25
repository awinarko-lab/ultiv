/**
 * The kenari.id provider: OpenAI-compatible gateway wired as a pi-ai
 * provider. This module is the only place that knows kenari's spec; the
 * fallback model constant lives in `config.ts` beside the env keys.
 */
import { Effect } from "effect";
import { ConfigError } from "effect/Config";
import { createProvider, envApiKeyAuth, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { AgentChange } from "@earendil-works/pi-durable";
import { kenariBaseUrl, kenariModel } from "../config.ts";

// models.dev kenari/deepseek-v4-1-flash; cross-checked against GET /v1/models (2026-10-24):
// context 1M, output 384k, reasoning model, USD/1M tokens.
const SPEC = {
  contextWindow: 1_000_000,
  maxTokens: 384_000,
  cost: { input: 0.15714286, output: 0.31428571, cacheRead: 0.00371429, cacheWrite: 0 },
};

export interface KenariWiring {
  readonly modelId: string;
  readonly baseUrl: string;
}

/** Resolve kenari's wiring from the environment. */
export const kenariWiring: Effect.Effect<KenariWiring, ConfigError> = Effect.gen(function* () {
  return { modelId: yield* kenariModel, baseUrl: yield* kenariBaseUrl };
});

/** The agent selection every conversation of the mind starts from. */
export const kenariAgent = (wiring: KenariWiring): AgentChange => ({
  model: { provider: "kenari", modelId: wiring.modelId },
});

/** Build the kenari provider for a model catalog. */
export const kenariProvider = (wiring: KenariWiring) => {
  const model: Model<"openai-completions"> = {
    id: wiring.modelId,
    name: `Kenari ${wiring.modelId}`,
    api: "openai-completions",
    provider: "kenari",
    baseUrl: wiring.baseUrl,
    reasoning: true,
    input: ["text", "image"],
    cost: SPEC.cost,
    contextWindow: SPEC.contextWindow,
    maxTokens: SPEC.maxTokens,
  };
  return createProvider({
    id: "kenari",
    name: "Kenari",
    baseUrl: wiring.baseUrl,
    auth: { apiKey: envApiKeyAuth("Kenari API key", ["KENARI_API_KEY"]) },
    models: [model],
    api: openAICompletionsApi(),
  });
};
