import { createProvider, envApiKeyAuth, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

// Single grep-able fallback (kenari-model-ops rule: env KENARI_MODEL is the source of truth).
export const KENARI_FALLBACK_MODEL = "deepseek-v4-1-flash";

// models.dev kenari/deepseek-v4-1-flash; cross-checked against GET /v1/models (2026-10-24):
// context 1M, output 384k, reasoning model, USD/1M tokens.
const SPEC = {
  contextWindow: 1_000_000,
  maxTokens: 384_000,
  cost: { input: 0.15714286, output: 0.31428571, cacheRead: 0.00371429, cacheWrite: 0 },
};

export function kenariModelId(): string {
  return process.env.KENARI_MODEL ?? KENARI_FALLBACK_MODEL;
}

/** Agent selection every conversation should start from (host default is kenari). */
export function kenariAgent() {
  return { model: { provider: "kenari", modelId: kenariModelId() } };
}

export function kenariProvider() {
  const baseUrl = process.env.KENARI_BASE_URL ?? "https://kenari.id/v1";
  const model: Model<"openai-completions"> = {
    id: kenariModelId(),
    name: `Kenari ${kenariModelId()}`,
    api: "openai-completions",
    provider: "kenari",
    baseUrl,
    reasoning: true,
    input: ["text", "image"],
    cost: SPEC.cost,
    contextWindow: SPEC.contextWindow,
    maxTokens: SPEC.maxTokens,
  };
  return createProvider({
    id: "kenari",
    name: "Kenari",
    baseUrl,
    auth: { apiKey: envApiKeyAuth("Kenari API key", ["KENARI_API_KEY"]) },
    models: [model],
    api: openAICompletionsApi(),
  });
}
