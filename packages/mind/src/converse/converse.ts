/**
 * The Converse faculty: durable conversations over the pi-durable harness.
 * `turn` — submit -> wait -> commit — is the ONLY path an input reaches a
 * model (owner rule: no raw provider calls). The harness is a scoped
 * resource of this layer: closing the layer closes the harness.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Context, Effect, Layer } from "effect";
import { ConfigError } from "effect/Config";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import {
  AssistantEntry,
  defineDocFamily,
  Harness,
  type AgentChange,
  type Conversation,
  type JsonObject,
  type ConversationId,
  type SessionDocToken,
  type Storage,
  type Submission,
  type Tx,
} from "@earendil-works/pi-durable";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { External } from "@ultiv/core";
import { harnessDb } from "../config.ts";
import { PiRegistry } from "./pi-registry.ts";
import {
  kenariAgent,
  kenariCompaction,
  kenariWiring,
  KENARI_MODELS,
  type KenariWiring,
} from "../providers/kenari.ts";
import { MindModels } from "../providers/models.ts";

export interface TurnResult {
  /** The committed assistant text; empty when the turn produced none. */
  readonly text: string;
}

/** The conversation's current model/effort selection; null = the mind's default. */
export interface AgentSelection {
  readonly model: string | null;
  readonly effort: ModelThinkingLevel | null;
}

export interface ConverseService {
  /** The reserved root conversation (probes, background jobs). */
  readonly root: () => Effect.Effect<Conversation, External>;
  /** Resolve the durable conversation behind an app key, creating and mapping it on first use. */
  readonly ensure: (key: string) => Effect.Effect<Conversation, External>;
  /** Open an existing durable conversation by id; undefined when there is none. */
  readonly open: (id: string) => Effect.Effect<Conversation | undefined, External>;
  /** Admit an input into the durable transcript (visibility = durability). */
  readonly submit: (
    conversation: Conversation,
    content: string,
  ) => Effect.Effect<Submission, External>;
  /** Settle an admitted submission: wait for the agent, commit the assistant entry. */
  readonly settle: (
    conversation: Conversation,
    submission: Submission,
  ) => Effect.Effect<TurnResult, External>;
  /** One admitted turn: submit -> settle. The only path an input reaches a model. */
  readonly turn: (
    conversation: Conversation,
    content: string,
  ) => Effect.Effect<TurnResult, External>;
  /** The conversation's current model/effort selection. */
  readonly agentOf: (conversation: Conversation) => Effect.Effect<AgentSelection, External>;
  /**
   * Apply a model/effort selection to a conversation — durable, in the
   * conversation's own commit. Partial: absent fields stay unchanged; null
   * resets a field to the mind's default.
   */
  readonly configure: (
    conversation: Conversation,
    selection: { readonly model?: string | null; readonly effort?: ModelThinkingLevel | null },
  ) => Effect.Effect<void, External>;
  /** App-level durable documents ride the same harness storage. */
  readonly docs: {
    readonly snapshot: <T extends JsonObject>(
      doc: SessionDocToken<T>,
    ) => Effect.Effect<T | undefined, External>;
    readonly commit: <T>(change: (tx: Tx) => T | Promise<T>) => Effect.Effect<T, External>;
  };
}

export class Converse extends Context.Service<Converse, ConverseService>()("ultiv/mind/Converse") {}

/** Durable session-key -> conversation mapping (kind preserved: pre-existing SQLite data). */
const SessionMapDoc = defineDocFamily<
  { conversationId: ConversationId },
  { conversationId: ConversationId }
>({
  kind: "ultiv.session-map",
  version: 1,
  scope: "session",
  family: true,
  initial: (seed) => ({ conversationId: seed.conversationId }),
  checkpointWhen: () => true,
});

const asEffect = <A>(op: string, promise: Promise<A>): Effect.Effect<A, External> =>
  Effect.tryPromise({ try: () => promise, catch: (cause) => new External({ op, cause }) });

/** Resolve the durable conversation behind an app key, creating and mapping it on first use. */
const ensureConversation = (harness: Harness, key: string, agent: AgentChange) =>
  Effect.gen(function* () {
    const known = yield* asEffect(
      "session map read",
      harness.snapshot(SessionMapDoc, key, BACKGROUND_CONTEXT),
    );
    if (known) {
      const existing = yield* asEffect(
        "conversation open",
        harness.conversation(known.conversationId, BACKGROUND_CONTEXT),
      );
      if (existing) return existing;
    }
    const created = yield* asEffect(
      "conversation create",
      harness.createConversation({ ownership: { kind: "ownerless" }, agent }, BACKGROUND_CONTEXT),
    );
    yield* asEffect(
      "session map write",
      harness.commit(async (tx) => {
        const draft = await tx.doc(SessionMapDoc, key, { conversationId: created.id });
        draft.conversationId = created.id;
      }, BACKGROUND_CONTEXT),
    );
    return created;
  });

/** One admitted turn: submit -> wait -> commit. */
const submitOf = (
  conversation: Conversation,
  content: string,
): Effect.Effect<Submission, External> =>
  asEffect("submit", conversation.submit({ type: "input", content }, BACKGROUND_CONTEXT));

const settleOf = (
  conversation: Conversation,
  submission: Submission,
): Effect.Effect<TurnResult, External> =>
  Effect.gen(function* () {
    const settled = yield* asEffect("agent wait", submission.wait(BACKGROUND_CONTEXT));
    if (settled.status !== "done" || settled.type !== "input") {
      return yield* new External({
        op: "agent turn",
        cause: `agent unanswered: ${JSON.stringify(settled).slice(0, 200)}`,
      });
    }
    const stored = yield* asEffect(
      "commit",
      conversation.commit((tx) => tx.entry(AssistantEntry, settled.answer), BACKGROUND_CONTEXT),
    );
    const message = stored?.model?.[0] as { content?: unknown } | undefined;
    return { text: textOf(message?.content) };
  });

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((block) => String((block as { text?: string }).text ?? "")).join("");
  }
  return JSON.stringify(content);
}

/** The model id off the resolved agent's model (a pi-ai `Model` or a `ModelRef`). */
const modelIdOf = (agent: { readonly model?: unknown }): string | null => {
  const model = agent.model as { readonly modelId?: string; readonly id?: string } | undefined;
  if (model === undefined || model === null) return null;
  return model.modelId ?? model.id ?? null;
};

const converseService = (harness: Harness, agent: AgentChange): ConverseService => ({
  root: () => asEffect("root conversation", harness.root(BACKGROUND_CONTEXT, { agent })),
  ensure: (key) => ensureConversation(harness, key, agent),
  open: (id) => {
    // Conversation ids are numeric today; accept any string form losslessly.
    const numeric = Number(id);
    const conversationId = (Number.isSafeInteger(numeric) && numeric >= 0
      ? numeric
      : id) as unknown as ConversationId;
    return asEffect("conversation open", harness.conversation(conversationId, BACKGROUND_CONTEXT));
  },
  submit: (conversation, content) => submitOf(conversation, content),
  settle: (conversation, submission) => settleOf(conversation, submission),
  turn: (conversation, content) =>
    Effect.flatMap(submitOf(conversation, content), (submission) =>
      settleOf(conversation, submission),
    ),
  agentOf: (conversation) =>
    Effect.flatMap(asEffect("agent read", conversation.agent(BACKGROUND_CONTEXT)), (resolved) => {
      const model = modelIdOf(resolved);
      const rawEffort = (resolved.thinkingLevel ?? null) as ModelThinkingLevel | null;
      // A stored effort may predate the model it now runs on; surface the
      // model's own default instead of an out-of-list value.
      const spec = KENARI_MODELS.find((candidate) => candidate.id === model);
      const effort =
        rawEffort !== null &&
        spec !== undefined &&
        !(spec.efforts as readonly string[]).includes(rawEffort)
          ? spec.defaultEffort
          : rawEffort;
      return Effect.succeed({ model, effort });
    }),
  configure: (conversation, selection) => {
    // Effort must be one the TARGET model supports: an effort carried over
    // from another model (e.g. `off` on an always-reasoning model) degrades
    // it. Snap out-of-list efforts to the model's own default.
    const spec =
      selection.model !== undefined
        ? KENARI_MODELS.find((candidate) => candidate.id === selection.model)
        : undefined;
    const requested = selection.effort;
    const effort =
      requested !== undefined &&
      requested !== null &&
      spec !== undefined &&
      !(spec.efforts as readonly string[]).includes(requested)
        ? spec.defaultEffort
        : requested;
    const change: AgentChange = {
      ...(selection.model !== undefined
        ? {
            model:
              selection.model === null ? null : { provider: "kenari", modelId: selection.model },
          }
        : {}),
      ...(effort !== undefined ? { thinkingLevel: effort } : {}),
    };
    return Effect.asVoid(
      asEffect("agent configure", conversation.configure(change, BACKGROUND_CONTEXT)),
    );
  },
  docs: {
    // The token is family-parametric; the harness call is typed once at this boundary.
    snapshot: <T extends JsonObject>(doc: SessionDocToken<T>) =>
      asEffect(
        "doc read",
        harness.snapshot(doc as SessionDocToken<JsonObject>, BACKGROUND_CONTEXT),
      ) as Effect.Effect<T | undefined, External>,
    commit: (change) => asEffect("doc commit", harness.commit(change, BACKGROUND_CONTEXT)),
  },
});

const openSqlite: Effect.Effect<Storage, External | ConfigError> = Effect.gen(function* () {
  const path = yield* harnessDb;
  yield* Effect.try({
    try: () => mkdirSync(dirname(path), { recursive: true }),
    catch: (cause) => new External({ op: `mkdir ${path}`, cause }),
  });
  return yield* asEffect("open storage", openNodeSqliteStorage(path));
});

/**
 * The Converse faculty. Storage overrides come from `openMind`; the model
 * catalog and the pi-durable registry are the mind's own. The act's tool
 * extension, codemode, and the task tools are installed into that registry by
 * the entity (see `entity.ts`) — pi-durable registries may keep changing
 * while the harness runs, so late installs reach every conversation.
 */
export const converseLayer = (
  storage: Storage | undefined,
): Layer.Layer<Converse, External | ConfigError, MindModels | PiRegistry> =>
  Layer.effect(
    Converse,
    Effect.gen(function* () {
      const models = yield* MindModels;
      const piRegistry = yield* PiRegistry;
      const wiring: KenariWiring = yield* kenariWiring;
      const resolvedStorage = yield* storage !== undefined ? Effect.succeed(storage) : openSqlite;
      const harness = yield* Effect.acquireRelease(
        asEffect(
          "open harness",
          Harness.open(
            resolvedStorage,
            { models, registry: piRegistry, settings: { compaction: kenariCompaction() } },
            BACKGROUND_CONTEXT,
          ),
        ),
        (harness) => Effect.ignore(asEffect("close harness", harness.close(BACKGROUND_CONTEXT))),
      );
      return converseService(harness, kenariAgent(wiring));
    }),
  );
