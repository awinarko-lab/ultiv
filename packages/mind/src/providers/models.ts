/**
 * The mind's model catalog. Providers register only when their key is
 * present, so the stack boots offline and faculties degrade loudly.
 */
import { Effect } from "effect";
import { ConfigError } from "effect/Config";
import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type { Models } from "@earendil-works/pi-ai";
import { Context, Layer, Option } from "effect";
import { kenariApiKey, openaiApiKey } from "../config.ts";
import { kenariProvider, kenariWiring } from "./kenari.ts";

export class MindModels extends Context.Service<MindModels, Models>()("ultiv/mind/Models") {}

export const modelsLayer: Layer.Layer<MindModels, ConfigError> = Layer.effect(
  MindModels,
  Effect.gen(function* () {
    const models = createModels();
    const openai = yield* openaiApiKey;
    if (Option.isSome(openai)) models.setProvider(openaiProvider());
    const kenari = yield* kenariApiKey;
    if (Option.isSome(kenari)) models.setProvider(kenariProvider(yield* kenariWiring));
    return models;
  }),
);
