/**
 * The mind — the platform's one AI entity, named **Ultius** (`@ultiv/mind`
 * keeps its working package name; the entity it implements is Ultius).
 * Chat is only one of its forms: `converse` (durable conversations),
 * `decide` (typed Jev decisions, independent of chat), `act` (its executable
 * tool surface, codemode and background tasks included), `generate` (one-shot
 * app-facing completion), and `audit` (what it did). Everything enters
 * through this service; nothing reaches a provider raw.
 */
import { Context, Effect, Layer } from "effect";
import { ConfigError } from "effect/Config";
import { defineExtension, type Storage } from "@earendil-works/pi-durable";
import { openRuntime, Duplicate, External, Unavailable, type Runtime } from "@ultiv/core";
import {
  artifactsPlugin,
  makeRegistry,
  Registry,
  tinyfishConfigured,
  tinyfishPlugin,
  type Plugin,
} from "@ultiv/ext";
import { Approvals, approvalsLayer, type ApprovalsService } from "./approvals.ts";
import { actService } from "./act/act.ts";
import { codemodeExtension } from "./act/codemode.ts";
import { taskTools } from "./act/task-tools.ts";
import { ENTITY_NAME, identityPlugin } from "./act/identity.ts";
import { decisionPlugin } from "./act/decision-tools.ts";
import { temporalPlugin } from "./act/temporal.ts";
import { Audit, auditLayer, type AuditService } from "./audit/audit.ts";
import { Converse, converseLayer, type ConverseService } from "./converse/converse.ts";
import { PiRegistry, piRegistryLayer } from "./converse/pi-registry.ts";
import { Tasks, tasksLayer, type TasksService } from "./tasks/tasks.ts";
import {
  Generate,
  generateLayer,
  type GenerateOptions,
  type GenerateService,
} from "./generate/generate.ts";
import { Decide, decideLayer, type DecideService } from "./decide/decide.ts";
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
  /** One-shot app-facing completion (titles, extraction) — no conversation. */
  readonly generate: GenerateService;
  /** Background sub-agent tasks in their own durable conversations. */
  readonly tasks: TasksService;
  /** The append-only trail of the mind's acts. */
  readonly audit: AuditService;
  readonly describe: () => MindDescription;
}

export class Mind extends Context.Service<Mind, MindService>()("ultiv/mind/Mind") {}

export interface MindOptions {
  /** Durable storage override; default is SQLite at HARNESS_DB (tests pass MemoryStorage). */
  readonly storage?: Storage;
  /** Extra extension plugins beyond the mind's own. */
  readonly plugins?: readonly Plugin[];
  /** Options for the generate faculty (token cap). */
  readonly generate?: GenerateOptions;
}

/** Everything that can fail while booting the mind. */
export type MindError = External | ConfigError | Unavailable | Duplicate;

const mindLayerRaw: Layer.Layer<
  Mind,
  never,
  Decide | Approvals | MindModels | Registry | Converse | Generate | Tasks | Audit | PiRegistry
> = Layer.effect(
  Mind,
  Effect.gen(function* () {
    const converse = yield* Converse;
    const decide = yield* Decide;
    const approvals = yield* Approvals;
    const registry = yield* Registry;
    const generate = yield* Generate;
    const tasks = yield* Tasks;
    const audit = yield* Audit;
    const act = actService(registry, approvals, audit);
    // Everything rides one pi-durable registry; late installs are legal —
    // the harness reconsiders its tools as the registry changes.
    const piRegistry = yield* PiRegistry;
    piRegistry.install(act.extension());
    piRegistry.install(codemodeExtension());
    piRegistry.install(defineExtension({ name: "ultius.mind.tasks", tools: taskTools(tasks) }));
    return {
      converse,
      decide,
      act,
      approvals,
      generate,
      tasks,
      audit,
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
 * plugin rides the registry); models + registry + approvals + audit +
 * pi-registry -> converse; converse -> tasks; models -> generate; all
 * services -> the entity.
 */
export const mindLayer = (options: MindOptions): Layer.Layer<Mind, MindError> => {
  const models = modelsLayer;
  const decide = decideLayer;
  const approvals = approvalsLayer;
  const audit = auditLayer;
  const piRegistry = piRegistryLayer;
  const generate = generateLayer(options.generate).pipe(Layer.provide(models));
  const registry = Layer.effect(
    Registry,
    Effect.gen(function* () {
      const decideService = yield* Decide;
      // First-party faculties ride always (identity, temporal, artifacts);
      // TinyFish live-web egress and Jev install only when keys are present.
      const base = [
        identityPlugin(),
        temporalPlugin(),
        artifactsPlugin(),
        ...(tinyfishConfigured() ? [tinyfishPlugin] : []),
      ];
      const plugins = decideService.available
        ? [...base, decisionPlugin(decideService), ...(options.plugins ?? [])]
        : [...base, ...(options.plugins ?? [])];
      return yield* makeRegistry(plugins);
    }),
  ).pipe(Layer.provide(decideLayer));
  const converse = converseLayer(options.storage).pipe(
    Layer.provide(
      models
        .pipe(Layer.merge(registry))
        .pipe(Layer.merge(approvals))
        .pipe(Layer.merge(audit))
        .pipe(Layer.merge(piRegistry)),
    ),
  );
  const tasks = tasksLayer.pipe(Layer.provide(converse));
  const dependencies = converse
    .pipe(Layer.merge(decide))
    .pipe(Layer.merge(approvals))
    .pipe(Layer.merge(models))
    .pipe(Layer.merge(registry))
    .pipe(Layer.merge(audit))
    .pipe(Layer.merge(piRegistry))
    .pipe(Layer.merge(generate))
    .pipe(Layer.merge(tasks));
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
