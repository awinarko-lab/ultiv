/**
 * The Tasks faculty: background work the entity runs in its own durable
 * conversation — the mind's sub-agent surface. `spawn` admits a prompt into a
 * fresh conversation and settles it in the background; when a task settles it
 * WAKES the conversation that spawned it with the outcome, so the parent ends
 * its turn instead of polling. A task runs AS its bot: the binder (wired by
 * the entity once the profiles index exists) creates the task's conversation
 * with the bot's own model and tools and indexes it under the bot BEFORE the
 * first turn, and the bot is kept on the row so a restart rebinds it.
 * Restarts do not kill tasks: once bound, every still-running task is resumed
 * with a continuation input (the transcript is durable), and only a genuinely
 * dead run ends up failed. REST and the act's task tools read the same doc.
 * Parts: store.ts (the doc), wake.ts (the parent wake).
 */
import { randomUUID } from "node:crypto";
import { Context, Effect, Layer } from "effect";
import { External } from "@ultiv/core";
import type { TaskInfo, TaskList } from "@ultiv/contracts";
import { Converse, type ConverseService } from "../converse/converse.ts";
import { findTask, readTasks, taskConversationKey, updateTask, writeTasks } from "./store.ts";
import { owed, wakeParent } from "./wake.ts";

export { TasksDoc, taskConversationKey, titleOf } from "./store.ts";

/** The bot a task runs as. */
export type TaskBot = NonNullable<TaskInfo["bot"]>;

/**
 * Binds a task conversation to its bot: ensures the conversation under `key`
 * (created with the bot's agent when new) and indexes it as the bot's task.
 * `stored` is the bot already on the row (resume); otherwise it is resolved
 * from the spawning conversation. Null when there is no bot (unscoped spawn).
 */
export type TaskBinder = (
  key: string,
  parentConversationId: string | null,
  stored: TaskBot | null,
) => Promise<TaskBot | null>;

export interface TasksService {
  /** Start a background turn in a fresh conversation; returns it running. */
  readonly spawn: (input: {
    readonly sessionId: string;
    readonly owner: string;
    /** Conversation to wake when the task settles; null = nobody (REST spawns). */
    readonly conversationId: string | null;
    readonly prompt: string;
    /** A short title for the owner's task list (≤40 chars); optional. */
    readonly title?: string;
  }) => Effect.Effect<TaskInfo, External>;
  readonly get: (id: string) => Effect.Effect<TaskInfo | undefined, External>;
  readonly list: () => Effect.Effect<TaskList, External>;
  /** Stop a running task: abort its conversation, mark cancelled, wake the parent. */
  readonly cancel: (id: string) => Effect.Effect<boolean, External>;
  /**
   * Remove a task from the registry entirely; a still-running task is
   * cancelled first (and its parent woken). The durable transcript stays.
   */
  readonly remove: (
    id: string,
  ) => Effect.Effect<{ readonly removed: boolean; readonly cancelled: boolean }, External>;
  /** True when the conversation belongs to a background task: tasks cannot spawn sub-tasks. */
  readonly isTaskConversation: (conversationId: string) => Effect.Effect<boolean, External>;
  /**
   * Wire the bot binder and resume still-running tasks. Called once by the
   * entity after the profiles index exists, so no task turn runs unbound.
   */
  readonly attach: (binder: TaskBinder) => Promise<void>;
}

export class Tasks extends Context.Service<Tasks, TasksService>()("ultiv/mind/Tasks") {}

const TITLE_CHARS = 40;

const RESUME_NOTE =
  "[resume] You were interrupted by a server restart. Continue the task from where the " +
  "transcript left off and produce the final deliverable now.";

/** Mutable wiring shared by the service's parts. */
interface TaskRuntime {
  readonly converse: ConverseService;
  binder: TaskBinder | null;
}

/** Ensure and bind the task's conversation before any turn reaches it. */
const bindTask = async (
  rt: TaskRuntime,
  id: string,
  parent: string | null,
  stored: TaskBot | null,
): Promise<TaskBot | null> => {
  const key = taskConversationKey(id);
  const bot = rt.binder === null ? null : await rt.binder(key, parent, stored).catch(() => null);
  // Unbound (no bot, or the binder failed): the conversation still exists.
  if (bot === null) await Effect.runPromise(rt.converse.ensure(key));
  return bot;
};

/**
 * Settles a spawned (or resumed) task in the background: the registry doc
 * carries the outcome and the spawning conversation is woken with it. A
 * cancellation wins over both outcomes: once the doc says "cancelled", the
 * runner keeps its hands off.
 */
const runTask = (rt: TaskRuntime, task: TaskInfo, prompt: string): void => {
  const { converse } = rt;
  void (async () => {
    try {
      const conversation = await Effect.runPromise(converse.ensure(taskConversationKey(task.id)));
      const result = await Effect.runPromise(converse.turn(conversation, prompt));
      await Effect.runPromise(
        updateTask(converse, task.id, (current) =>
          current.status === "cancelled"
            ? current
            : {
                ...current,
                status: "done",
                result: result.text,
                finishedAt: Date.now(),
                ...owed(current),
              },
        ),
      );
    } catch (cause) {
      const error = String(cause).slice(0, 500);
      await Effect.runPromise(
        updateTask(converse, task.id, (current) =>
          current.status === "cancelled"
            ? current
            : { ...current, status: "failed", error, finishedAt: Date.now(), ...owed(current) },
        ),
      ).catch(() => undefined);
    }
    await wakeParent(converse, task.id);
  })();
};

/**
 * Stop a running task: abort its conversation, mark cancelled, wake the
 * parent. Idempotent — only a running task is cancelled.
 */
const cancelTask = (converse: ConverseService, id: string): Effect.Effect<boolean, External> =>
  Effect.gen(function* () {
    const task = yield* findTask(converse, id);
    if (task === undefined || task.status !== "running") return false;
    // Stop the work first, then write the outcome: the runner honors the
    // cancelled status and keeps its hands off when it settles.
    const conversation = yield* converse.ensure(taskConversationKey(id));
    yield* converse.interrupt(conversation);
    yield* updateTask(converse, id, (current) =>
      current.status === "running"
        ? {
            ...current,
            status: "cancelled",
            error: "cancelled by the user",
            finishedAt: Date.now(),
            ...owed(current),
          }
        : current,
    );
    yield* Effect.tryPromise({
      try: () => wakeParent(converse, id),
      catch: (cause) => new External({ op: "task cancel wake", cause }),
    }).pipe(Effect.ignore);
    return true;
  });

const spawnTask =
  (rt: TaskRuntime): TasksService["spawn"] =>
  (input) =>
    Effect.gen(function* () {
      const id = randomUUID();
      // The conversation exists, with the bot's agent, and is indexed under
      // the bot before the task is admitted: the first turn already runs as
      // the bot, and an unrecorded input never leaves an orphan transcript.
      const bot = yield* Effect.tryPromise({
        try: () => bindTask(rt, id, input.conversationId, null),
        catch: (cause) => new External({ op: "task bind", cause }),
      });
      const title = input.title?.trim().slice(0, TITLE_CHARS) ?? "";
      const task: TaskInfo = {
        id,
        sessionId: input.sessionId,
        owner: input.owner,
        conversationId: input.conversationId,
        prompt: input.prompt,
        status: "running",
        result: null,
        error: null,
        createdAt: Date.now(),
        finishedAt: null,
        ...(title !== "" ? { title } : {}),
        ...(bot !== null ? { bot } : {}),
      };
      yield* Effect.flatMap(readTasks(rt.converse), (tasks) =>
        writeTasks(rt.converse, [...tasks, task]),
      );
      runTask(rt, task, input.prompt);
      return task;
    });

/**
 * Boot-time resume: the in-process runner dies with the old process, but the
 * task's transcript is durable. Rebind each still-running task to its bot
 * (from the row, else from the spawning chat), re-admit a continuation input
 * and re-attach a runner. A task that finished but whose parent was never
 * woken (the crash hit in between) wakes the parent now.
 */
const resumeRunning = async (rt: TaskRuntime): Promise<void> => {
  const tasks = await Effect.runPromise(readTasks(rt.converse));
  for (const task of tasks) {
    if (task.status === "running") {
      const bot = await bindTask(rt, task.id, task.conversationId, task.bot ?? null);
      if (bot !== null && task.bot === undefined) {
        await Effect.runPromise(updateTask(rt.converse, task.id, (row) => ({ ...row, bot })));
      }
      runTask(rt, task, RESUME_NOTE);
    } else if (task.notified === false) void wakeParent(rt.converse, task.id);
  }
};

export const tasksService = (converse: ConverseService): TasksService => {
  const rt: TaskRuntime = { converse, binder: null };
  let attached = false;
  return {
    spawn: spawnTask(rt),
    get: (id) => findTask(converse, id),
    list: () => readTasks(converse),
    cancel: (id) => cancelTask(converse, id),
    remove: (id) =>
      Effect.gen(function* () {
        const task = yield* findTask(converse, id);
        if (task === undefined) return { removed: false, cancelled: false };
        const cancelled = task.status === "running" ? yield* cancelTask(converse, id) : false;
        yield* Effect.flatMap(readTasks(converse), (tasks) =>
          writeTasks(
            converse,
            tasks.filter((candidate) => candidate.id !== id),
          ),
        );
        return { removed: true, cancelled };
      }),
    isTaskConversation: (conversationId) =>
      Effect.flatMap(readTasks(converse), (tasks) =>
        Effect.map(
          Effect.forEach(tasks, (task) => converse.conversationIdOf(taskConversationKey(task.id)), {
            concurrency: "unbounded",
          }),
          (ids) => ids.some((id) => id === conversationId),
        ),
      ),
    attach: async (binder) => {
      rt.binder = binder;
      if (attached) return;
      attached = true;
      await resumeRunning(rt).catch((cause) => console.error("task resume failed:", cause));
    },
  };
};

export const tasksLayer: Layer.Layer<Tasks, External, Converse> = Layer.effect(
  Tasks,
  Effect.gen(function* () {
    return tasksService(yield* Converse);
  }),
);
