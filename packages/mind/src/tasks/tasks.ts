/**
 * The Tasks faculty: background work the entity runs in its own durable
 * conversation — the mind's sub-agent surface. `spawn` admits a prompt into a
 * fresh conversation and settles it in the background; when a task settles it
 * WAKES the conversation that spawned it with the outcome, so the parent ends
 * its turn instead of polling. Restarts do not kill tasks: on boot every
 * still-running task is resumed with a continuation input (the transcript is
 * durable), and only a genuinely dead run ends up failed. REST and the act's
 * task tools read the same registry doc.
 */
import { randomUUID } from "node:crypto";
import { defineDoc } from "@earendil-works/pi-durable";
import { Context, Effect, Layer } from "effect";
import { External } from "@ultiv/core";
import type { TaskInfo, TaskList } from "@ultiv/contracts";
import { Converse, type ConverseService } from "../converse/converse.ts";

export interface TasksService {
  /** Start a background turn in a fresh conversation; returns it running. */
  readonly spawn: (input: {
    readonly sessionId: string;
    readonly owner: string;
    /** Conversation to wake when the task settles; null = nobody (REST spawns). */
    readonly conversationId: string | null;
    readonly prompt: string;
  }) => Effect.Effect<TaskInfo, External>;
  readonly get: (id: string) => Effect.Effect<TaskInfo | undefined, External>;
  readonly list: () => Effect.Effect<TaskList, External>;
  /** Stop a running task: abort its conversation, mark cancelled, wake the parent. */
  readonly cancel: (id: string) => Effect.Effect<boolean, External>;
  /** True when the conversation belongs to a background task: tasks cannot spawn sub-tasks. */
  readonly isTaskConversation: (conversationId: string) => Effect.Effect<boolean, External>;
}

export class Tasks extends Context.Service<Tasks, TasksService>()("ultiv/mind/Tasks") {}

/** The registry doc; exported for tests and read-only surfaces. */
export const TasksDoc = defineDoc<{ tasks: TaskInfo[] }>({
  kind: "ultiv.tasks",
  version: 1,
  scope: "session",
  initial: () => ({ tasks: [] }),
  checkpointWhen: () => true,
});

const taskConversationKey = (id: string): string => `task:${id}`;

/** Legacy rows predate `conversationId`; normalize on every read. */
const normalize = (task: TaskInfo): TaskInfo => ({
  ...task,
  conversationId: task.conversationId ?? null,
});

const readTasks = (converse: ConverseService): Effect.Effect<TaskInfo[], External> =>
  Effect.map(converse.docs.snapshot(TasksDoc), (doc) => (doc?.tasks ?? []).map(normalize));

const writeTasks = (converse: ConverseService, tasks: TaskInfo[]): Effect.Effect<void, External> =>
  converse.docs.commit(async (tx) => {
    const draft = await tx.doc(TasksDoc);
    draft.tasks = tasks;
  });

const updateTask = (
  converse: ConverseService,
  id: string,
  change: (task: TaskInfo) => TaskInfo,
): Effect.Effect<void, External> =>
  Effect.flatMap(readTasks(converse), (tasks) =>
    writeTasks(
      converse,
      tasks.map((task) => (task.id === id ? change(task) : task)),
    ),
  );

const WAKE_RESULT_CHARS = 4_000;
const RESUME_NOTE =
  "[resume] You were interrupted by a server restart. Continue the task from where the " +
  "transcript left off and produce the final deliverable now.";

/** Submit the outcome into the spawning conversation; best-effort, never throws. */
const wakeParent = async (
  converse: ConverseService,
  task: TaskInfo,
  text: string,
): Promise<void> => {
  if (task.conversationId === null) return;
  try {
    const parent = await Effect.runPromise(converse.open(task.conversationId));
    if (parent === undefined) return;
    const submission = await Effect.runPromise(converse.submit(parent, text));
    void Effect.runPromise(converse.settle(parent, submission)).catch((cause) => {
      console.error("wake turn failed:", cause);
    });
  } catch (cause) {
    console.error("task wake failed:", cause);
  }
};

/**
 * Settles a spawned (or resumed) task in the background: the registry doc
 * carries the outcome and the spawning conversation is woken with it. A
 * cancellation wins over both outcomes: once the doc says "cancelled", the
 * runner keeps its hands off.
 */
const runTask = (converse: ConverseService, task: TaskInfo, prompt: string): void => {
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
              },
        ),
      );
      const digest =
        result.text.length > WAKE_RESULT_CHARS
          ? `${result.text.slice(0, WAKE_RESULT_CHARS)}\n[truncated — full result: task_status "${task.id}"]`
          : result.text;
      await wakeParent(converse, task, `[task ${task.id} finished]\n\n${digest}`);
    } catch (cause) {
      const error = String(cause).slice(0, 500);
      await Effect.runPromise(
        updateTask(converse, task.id, (current) =>
          current.status === "cancelled"
            ? current
            : {
                ...current,
                status: "failed",
                error,
                finishedAt: Date.now(),
              },
        ),
      ).catch(() => undefined);
      await wakeParent(converse, task, `[task ${task.id} failed] ${error}`);
    }
  })();
};

export const tasksService = (converse: ConverseService): TasksService => ({
  spawn: (input) =>
    Effect.gen(function* () {
      const id = randomUUID();
      // The conversation exists before the task is admitted: an input the
      // registry never recorded must not leave an orphan transcript behind.
      yield* converse.ensure(taskConversationKey(id));
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
      };
      yield* Effect.flatMap(readTasks(converse), (tasks) => writeTasks(converse, [...tasks, task]));
      runTask(converse, task, input.prompt);
      return task;
    }),
  get: (id) => Effect.map(readTasks(converse), (tasks) => tasks.find((task) => task.id === id)),
  list: () => readTasks(converse),
  cancel: (id) =>
    Effect.gen(function* () {
      const task = yield* Effect.map(readTasks(converse), (tasks) =>
        tasks.find((candidate) => candidate.id === id),
      );
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
            }
          : current,
      );
      yield* Effect.tryPromise({
        try: () => wakeParent(converse, task, `[task ${id} cancelled] stopped before completion.`),
        catch: (cause) => new External({ op: "task cancel wake", cause }),
      }).pipe(Effect.ignore);
      return true;
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
});

/**
 * Boot-time resume: the in-process runner dies with the old process, but the
 * task's transcript is durable. Re-admit a continuation input and re-attach a
 * runner — only tasks still marked running, only their own conversations.
 */
const resumeRunning = (converse: ConverseService): Effect.Effect<void, External> =>
  Effect.map(readTasks(converse), (tasks) => {
    for (const task of tasks) {
      if (task.status === "running") runTask(converse, task, RESUME_NOTE);
    }
  });

export const tasksLayer: Layer.Layer<Tasks, External, Converse> = Layer.effect(
  Tasks,
  Effect.gen(function* () {
    const converse = yield* Converse;
    yield* Effect.ignore(resumeRunning(converse));
    return tasksService(converse);
  }),
);
