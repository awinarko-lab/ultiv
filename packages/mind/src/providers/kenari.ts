/**
 * The kenari.id provider: OpenAI-compatible gateway wired as a pi-ai
 * provider. This module is the only place that knows kenari's lineup and
 * specs; the fallback model constant lives in `config.ts` beside the env
 * keys.
 *
 * Catalog (owner selection, all through kenari for now), verified against
 * `GET /v1/models` (2026-10-25) and priced from models.dev's kenari entry
 * where present (minimax-m3-1-flash: gateway metadata + IDR→USD ÷ 16,500).
 */
import { Effect } from "effect";
import { ConfigError } from "effect/Config";
import { createProvider, envApiKeyAuth, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { AgentChange, CompactionSettings } from "@earendil-works/pi-durable";
import { kenariBaseUrl, kenariModel } from "../config.ts";

/**
 * Efforts the platform offers, from each gateway model's
 * `supported_reasoning_levels` (checked 2026-10-25): deepseek-v4-1-flash
 * none/low/high/max (toggleable), glm-5-3-flash low/high/max,
 * minimax-m3-1-flash low/medium/high/xhigh/max (all of glm/minimax always
 * reason — no off outside deepseek). `off` maps to the gateway's `none`.
 */
export type SessionEffort = "off" | "low" | "medium" | "high" | "xhigh" | "max";

/** One selectable model of the mind, with the efforts IT offers. */
export interface KenariModelSpec {
  readonly id: string;
  readonly label: string;
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly reasoning: boolean;
  readonly efforts: readonly SessionEffort[];
  readonly defaultEffort: SessionEffort;
}

const EFFORTS_TOGGLEABLE = ["off", "low", "high", "max"] as const;
const EFFORTS_ALWAYS = ["low", "high", "max"] as const;
const EFFORTS_WIDE = ["low", "medium", "high", "xhigh", "max"] as const;

export const KENARI_MODELS: readonly KenariModelSpec[] = [
  {
    id: "deepseek-v4-1-flash",
    label: "DeepSeek 4.1 Flash",
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    reasoning: true,
    efforts: EFFORTS_TOGGLEABLE,
    defaultEffort: "off",
  },
  {
    id: "glm-5-3-flash",
    label: "GLM 5.3 Flash",
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    reasoning: true,
    efforts: EFFORTS_ALWAYS,
    defaultEffort: "low",
  },
  {
    id: "minimax-m3-1-flash",
    label: "MiniMax M3.1 Flash",
    contextWindow: 1_000_000,
    maxTokens: 512_000,
    reasoning: true,
    efforts: EFFORTS_WIDE,
    defaultEffort: "low",
  },
];

/**
 * USD per 1M tokens (models.dev; kimi-k3-1-pro derived from gateway IDR).
 * pi-ai computes per-usage cost internally from these rates; the platform
 * surfaces TOKENS only — cost is deliberately not part of any contract.
 */
const COST_RATES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  "deepseek-v4-1-flash": {
    input: 0.15714286,
    output: 0.31428571,
    cacheRead: 0.00371429,
    cacheWrite: 0,
  },
  "glm-5-3-flash": { input: 0.11428571, output: 0.34285714, cacheRead: 0.02285714, cacheWrite: 0 },
  "minimax-m3-1-flash": {
    input: 0.01939394,
    output: 0.07878788,
    cacheRead: 0.00363636,
    cacheWrite: 0,
  },
};
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * Compaction at 75%: generation blocks to compact once a conversation
 * reaches 75% of its model's context window (`reserveTokens` is the other
 * 25%, kept free for the answer). Background compaction runs 32k tokens
 * early; a summary keeps the most recent eighth verbatim.
 */
export const kenariCompaction = (): CompactionSettings => ({
  enabled: true,
  modelOverrides: Object.fromEntries(
    KENARI_MODELS.map((model) => [
      `kenari/${model.id}`,
      {
        reserveTokens: Math.floor(model.contextWindow * 0.25),
        keepRecentTokens: Math.min(131_072, Math.floor(model.contextWindow * 0.125)),
        backgroundTokens: 32_000,
      },
    ]),
  ),
});

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

/** Build the kenari provider serving the whole catalog. */
export const kenariProvider = (wiring: KenariWiring) => {
  const models: Model<"openai-completions">[] = KENARI_MODELS.map((spec) => ({
    id: spec.id,
    name: spec.label,
    api: "openai-completions",
    provider: "kenari",
    baseUrl: wiring.baseUrl,
    reasoning: spec.reasoning,
    input: ["text", "image"],
    cost: COST_RATES[spec.id] ?? ZERO_COST,
    contextWindow: spec.contextWindow,
    maxTokens: spec.maxTokens,
  }));
  return createProvider({
    id: "kenari",
    name: "Kenari",
    baseUrl: wiring.baseUrl,
    auth: { apiKey: envApiKeyAuth("Kenari API key", ["KENARI_API_KEY"]) },
    models,
    api: openAICompletionsApi(),
  });
};
