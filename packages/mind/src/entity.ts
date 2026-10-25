/**
 * The mind — the platform's one AI entity, named **Ultius** (`@ultiv/mind`
 * keeps its working package name; the entity it implements is Ultius).
 * Chat is only one of its forms: `converse` (durable
 * conversations), `decide` (typed Jev decisions, independent of chat),
 * `act` (its executable tool surface). Everything enters through this
 * service; nothing reaches a provider raw.
 */
import { Context, Effect, Layer } from "effect";
import { ConfigError } from "effect/Config";
import type { Storage } from "@earendil-works/pi-durable";
import { openRuntime, Duplicate, External, Unavailable, type Runtime } from "@ultiv/core";
import {
  makeRegistry,
  Registry,
  tinyfishConfigured,
  tinyfishPlugin,
  type Plugin,
} from "@ultiv/ext";
import { Approvals, approvalsLayer, type ApprovalsService } from "./approvals.ts";
import { actService } from "./act/act.ts";
import { ENTITY_NAME, identityPlugin } from "./act/identity.ts";
import { decisionPlugin } from "./act/decision-tools.ts";
import { temporalPlugin } from "./act/temporal.ts";
import { Converse, converseLayer, type ConverseService } from "./converse/converse.ts";
import { decideLayer, Decide, type DecideService } from "./decide/decide.ts";
import { MindModels, modelsLayer } from "./providers/models.ts";

export interface MindDescription {
  readonly entity: string;
  /** The decide faculty is configured (TYPESAFE_API_KEY present). */
  readonly decide: boolean;
  readonly tools: readonly string[];
}

export interface MindService {
  /** Durable conversations — chat is one form of the entity, not its whole. */
  readonly converse: ConverseService;
  /** Typed decisions through Jev — usable with zero chat. */
  readonly decide: DecideService;
  /** The mind's tool surface. */
  readonly act: ReturnType<typeof actService>;
  /** The user-approval surface behind gated acts. */
  readonly approvals: ApprovalsService;
  readonly describe: () => MindDescription;
}

export class Mind extends Context.Service<Mind, MindService>()("ultiv/mind/Mind") {}

export interface MindOptions {
  /** Durable storage override; default is SQLite at HARNESS_DB (tests pass MemoryStorage). */
  readonly storage?: Storage;
  /** Extra extension plugins beyond the mind's own. */
  readonly plugins?: readonly Plugin[];
}

/** Everything that can fail while booting the mind. */
export type MindError = External | ConfigError | Unavailable | Duplicate;

const mindLayerRaw: Layer.Layer<
  Mind,
  never,
  Decide | Approvals | MindModels | Registry | Converse
> = Layer.effect(
  Mind,
  Effect.gen(function* () {
    const converse = yield* Converse;
    const decide = yield* Decide;
    const approvals = yield* Approvals;
    const registry = yield* Registry;
    const act = actService(registry, approvals);
    return {
      converse,
      decide,
      act,
      approvals,
      describe: () => ({
        entity: ENTITY_NAME,
        decide: decide.available,
        tools: act.tools().map((tool) => tool.name),
      }),
    };
  }),
);

/**
 * The whole mind from options. Wiring: decide -> registry (the decision
 * plugin rides the registry); models + registry + approvals -> converse;
 * all five services -> the entity.
 */
export const mindLayer = (options: MindOptions): Layer.Layer<Mind, MindError> => {
  const registry = Layer.effect(
    Registry,
    Effect.gen(function* () {
      const decide = yield* Decide;
      // First-party faculties ride always (identity, temporal); TinyFish
      // live-web egress and Jev install only when their keys are present.
      const base = [
        identityPlugin(),
        temporalPlugin(),
        ...(tinyfishConfigured() ? [tinyfishPlugin] : []),
      ];
      const plugins = decide.available
        ? [...base, decisionPlugin(decide), ...(options.plugins ?? [])]
        : [...base, ...(options.plugins ?? [])];
      return yield* makeRegistry(plugins);
    }),
  ).pipe(Layer.provide(decideLayer));
  const converse = converseLayer(options.storage).pipe(
    Layer.provide(modelsLayer.pipe(Layer.merge(registry), Layer.merge(approvalsLayer))),
  );
  const dependencies = converse
    .pipe(Layer.merge(decideLayer))
    .pipe(Layer.merge(approvalsLayer))
    .pipe(Layer.merge(modelsLayer))
    .pipe(Layer.merge(registry));
  return mindLayerRaw.pipe(Layer.provide(dependencies));
};

export interface MindHandle {
  readonly mind: MindService;
  /** Runs the mind's finalizers (durable harness). */
  readonly close: () => Promise<void>;
}

/** The promise-land door: open a live mind. The server and the probe enter here. */
export const openMind = (options: MindOptions = {}): Promise<MindHandle> =>
  openRuntime(mindLayer(options), Mind).then((runtime: Runtime<MindService>) => ({
    mind: runtime.service,
    close: runtime.close,
  }));
