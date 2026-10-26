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
  createScopeHolder,
  makeRegistry,
  Registry,
  tinyfishConfigured,
  tinyfishPlugin,
  vaultConfigured,
  vaultDir,
  makeVaultStore,
  vaultPlugin,
  type Plugin,
  type VaultStore,
} from "@ultiv/ext";
import { Approvals, approvalsLayer, type ApprovalsService } from "./approvals.ts";
import { actService } from "./act/act.ts";
import { codemodeExtension } from "./act/codemode.ts";
import { taskTools } from "./act/task-tools.ts";
import { ENTITY_NAME } from "./act/identity.ts";
import type { ScopeHolder } from "@ultiv/ext";
import { decisionPlugin } from "./act/decision-tools.ts";
import { temporalPlugin } from "./act/temporal.ts";
import { Audit, auditLayer, type AuditService } from "./audit/audit.ts";
import { Converse, converseLayer, type ConverseService } from "./converse/converse.ts";
import { PiRegistry, piRegistryLayer } from "./converse/pi-registry.ts";
import { Tasks, tasksLayer, type TasksService } from "./tasks/tasks.ts";
import { profilesService, type ProfilesService } from "./profiles/profiles.ts";
import { profilesExtension } from "./profiles/section.ts";
import { roomsService, type RoomsService } from "./profiles/rooms.ts";
import { mailboxService, type MailboxService } from "./mailbox/mailbox.ts";
import { messageTools } from "./mailbox/tools.ts";
import { memoryService, type MemoryService } from "./memory/memory.ts";
import { memoryTools } from "./memory/tools.ts";
import { historyService, type HistoryService } from "./history/history.ts";
import { historyTools } from "./history/tools.ts";
import { schedulesService, type SchedulesService } from "./schedules/schedules.ts";
import { scheduleTools } from "./schedules/tools.ts";
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
  /** User-defined entities above sessions: registry, Bot Mode, DM threads. */
  readonly profiles: ProfilesService;
  /** Contextual rooms between bots — one conversation per participant. */
  readonly rooms: RoomsService;
  /** Inter-entity messaging on per-pair DM threads. */
  readonly mailbox: MailboxService;
  /** The memory seam: profile and owner stores with write authority. */
  readonly memory: MemoryService;
  /** Rereading the entity's own past: search over durable transcripts. */
  readonly history: HistoryService;
  /** Self-set schedules: cron and one-shot wake-ups the entity owns. */
  readonly schedules: SchedulesService;
  /** The credential vault, when VAULT_KEY is configured; else null. */
  readonly vault: VaultStore | null;
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
  /** Options for the vault (directory override). */
  readonly vault?: { readonly dir?: string };
  /** Mailbox wiring; `grantArtifacts` materializes envelope artifact grants. */
  readonly mailbox?: {
    readonly grantArtifacts?: (
      owner: string,
      from: string,
      to: string,
      ids: readonly string[],
    ) => Promise<void>;
  };
  /** Schedule-registry wiring: `onChanged` re-arms the server's cron scheduler. */
  readonly schedules?: { readonly onChanged?: () => Promise<void> };
}

/** Everything that can fail while booting the mind. */
export type MindError = External | ConfigError | Unavailable | Duplicate;

/** Wiring built in `mindLayer` that the entity composition consumes. */
interface MindWiring {
  readonly holder: ScopeHolder;
  readonly vaultStore: VaultStore | null;
  /** Materializes mailbox envelope artifact grants (server copies files). */
  readonly grantArtifacts?: (
    owner: string,
    from: string,
    to: string,
    ids: readonly string[],
  ) => Promise<void>;
  /** Re-arms the server's cron scheduler after a schedule-registry change. */
  readonly onSchedulesChanged?: () => Promise<void>;
}

const mindLayerRaw = (
  wiring: MindWiring,
): Layer.Layer<
  Mind,
  never,
  Decide | Approvals | MindModels | Registry | Converse | Generate | Tasks | Audit | PiRegistry
> =>
  Layer.effect(
    Mind,
    Effect.gen(function* () {
      const converse = yield* Converse;
      const decide = yield* Decide;
      const approvals = yield* Approvals;
      const registry = yield* Registry;
      const generate = yield* Generate;
      const tasks = yield* Tasks;
      const audit = yield* Audit;
      const act = actService(
        registry,
        approvals,
        audit,
        (conversationId) => profilesRef?.profileOf(conversationId)?.id ?? null,
      );
      // One runtime, one entity per profile: the profiles service owns the
      // session registry and the conversation→profile index; its identity
      // section (persona + roster, or the substrate baseline) reaches every
      // conversation through a late registry install.
      const profiles = profilesService({
        converse,
        generate,
        tools: () => act.extension().tools ?? [],
      });
      const profilesRef: ProfilesService = profiles;
      const rooms = roomsService({ converse });
      const mailbox = mailboxService({
        converse,
        profiles,
        rooms,
        audit,
        ...(wiring.grantArtifacts !== undefined ? { grantArtifacts: wiring.grantArtifacts } : {}),
      });
      const memory = memoryService({ converse, profiles });
      const history = historyService({ converse, profiles });
      const schedules = schedulesService({
        converse,
        profiles,
        ...(wiring.onSchedulesChanged !== undefined
          ? { onChanged: wiring.onSchedulesChanged }
          : {}),
      });
      // Profile scoping reaches the ext plugins (artifacts dirs, vault lists)
      // through the holder the registry was built with — set now that the
      // conversation→profile index exists.
      wiring.holder.set({
        scopeOf: (conversationId) => {
          const scope = profiles.scopeOf(conversationId);
          return scope === undefined ? undefined : { owner: scope.owner, profile: scope.profileId };
        },
      });
      // Per-profile approval policy (auto-approve lists, timeout escalation).
      approvals.setHooks({
        autoApprove: (conversationId, request) =>
          profiles.profileOf(conversationId)?.policies.autoApprove.includes(request.name) === true,
        onExpire: (conversationId, request) => {
          audit.record({
            at: Date.now(),
            kind: "escalation",
            conversationId,
            profile: profiles.profileOf(conversationId)?.id ?? null,
            callId: request.callId,
            name: request.name,
            durationMs: null,
            ok: false,
            error: "approval timed out",
          });
        },
      });
      // Everything rides one pi-durable registry; late installs are legal —
      // the harness reconsiders its tools as the registry changes.
      const piRegistry = yield* PiRegistry;
      piRegistry.install(act.extension());
      piRegistry.install(codemodeExtension());
      piRegistry.install(profilesExtension(profiles, ENTITY_NAME));
      piRegistry.install(
        defineExtension({ name: "ultius.mind.tasks", tools: taskTools(tasks, profiles) }),
      );
      piRegistry.install(
        defineExtension({
          name: "ultius.mind.mailbox",
          tools: messageTools(mailbox, profiles, rooms),
        }),
      );
      piRegistry.install(
        defineExtension({ name: "ultius.mind.memory", tools: memoryTools(memory, profiles) }),
      );
      piRegistry.install(
        defineExtension({
          name: "ultius.mind.schedules",
          tools: scheduleTools(schedules, profiles),
        }),
      );
      piRegistry.install(
        defineExtension({
          name: "ultius.mind.history",
          tools: historyTools(history, profiles),
        }),
      );
      return {
        converse,
        decide,
        act,
        approvals,
        generate,
        tasks,
        profiles,
        rooms,
        mailbox,
        memory,
        schedules,
        history,
        vault: wiring.vaultStore,
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
  // The scope holder is created before the registry so ext plugins (artifacts
  // dirs, vault lists) can partition per profile; the entity sets it once the
  // conversation→profile index exists. Same lifecycle for the vault store.
  const holder = createScopeHolder();
  const vaultStore = vaultConfigured() ? makeVaultStore(options.vault?.dir ?? vaultDir()) : null;
  const wiring: MindWiring = {
    holder,
    vaultStore,
    ...(options.mailbox?.grantArtifacts !== undefined
      ? { grantArtifacts: options.mailbox.grantArtifacts }
      : {}),
    ...(options.schedules?.onChanged !== undefined
      ? { onSchedulesChanged: options.schedules.onChanged }
      : {}),
  };
  const registry = Layer.effect(
    Registry,
    Effect.gen(function* () {
      const decideService = yield* Decide;
      // First-party faculties ride always (temporal, artifacts); the vault and
      // TinyFish live-web egress and Jev install only when keys are present.
      const base = [
        temporalPlugin(),
        artifactsPlugin({ holder }),
        ...(vaultStore !== null ? [vaultPlugin(vaultStore, holder)] : []),
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
  return mindLayerRaw(wiring).pipe(Layer.provide(dependencies));
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
