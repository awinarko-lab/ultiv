/**
 * The Tasks faculty: background work the entity runs in its own durable
 * conversation — the mind's sub-agent surface. `spawn` admits a prompt into a
 * fresh conversation and settles it in the background; the durable transcript
 * survives restarts, and a reaper marks tasks orphaned by one as failed, so
 * nothing is left claiming "running" forever. REST and the act's task tools
 * read the same registry doc.
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
    readonly prompt: string;
  }) => Effect.Effect<TaskInfo, External>;
  readonly get: (id: string) => Effect.Effect<TaskInfo | undefined, External>;
  readonly list: () => Effect.Effect<TaskList, External>;
}

export class Tasks extends Context.Service<Tasks, TasksService>()("ultiv/mind/Tasks") {}

const TasksDoc = defineDoc<{ tasks: TaskInfo[] }>({
  kind: "ultiv.tasks",
  version: 1,
  scope: "session",
  initial: () => ({ tasks: [] }),
  checkpointWhen: () => true,
});

const taskConversationKey = (id: string): string => `task:${id}`;

const updateTask = (
  converse: ConverseService,
  id: string,
  change: (task: TaskInfo) => TaskInfo,
): Effect.Effect<void, External> =>
  converse.docs.commit(async (tx) => {
    const draft = await tx.doc(TasksDoc);
    draft.tasks = draft.tasks.map((task) => (task.id === id ? change(task) : task));
  });

/** Settles a spawned task in the background; the registry doc carries the outcome. */
const runTask = (converse: ConverseService, task: TaskInfo): void => {
  void (async () => {
    try {
      const conversation = await Effect.runPromise(converse.ensure(taskConversationKey(task.id)));
      const result = await Effect.runPromise(converse.turn(conversation, task.prompt));
      await Effect.runPromise(
        updateTask(converse, task.id, (current) => ({
          ...current,
          status: "done",
          result: result.text,
          finishedAt: Date.now(),
        })),
      );
    } catch (cause) {
      await Effect.runPromise(
        updateTask(converse, task.id, (current) => ({
          ...current,
          status: "failed",
          error: String(cause).slice(0, 500),
          finishedAt: Date.now(),
        })),
      ).catch(() => undefined);
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
        prompt: input.prompt,
        status: "running",
        result: null,
        error: null,
        createdAt: Date.now(),
        finishedAt: null,
      };
      yield* converse.docs.commit(async (tx) => {
        const draft = await tx.doc(TasksDoc);
        draft.tasks = [...draft.tasks, task];
      });
      runTask(converse, task);
      return task;
    }),
  get: (id) =>
    Effect.map(converse.docs.snapshot(TasksDoc), (doc) =>
      doc?.tasks.find((task) => task.id === id),
    ),
  list: () => Effect.map(converse.docs.snapshot(TasksDoc), (doc) => doc?.tasks ?? []),
});

/** Mark tasks a restart interrupted (no runner left) as failed, loudly. */
const reapOrphans = (converse: ConverseService): Effect.Effect<void, External> =>
  converse.docs.commit(async (tx) => {
    const draft = await tx.doc(TasksDoc);
    draft.tasks = draft.tasks.map((task) =>
      task.status === "running"
        ? {
            ...task,
            status: "failed",
            error: "interrupted by restart",
            finishedAt: Date.now(),
          }
        : task,
    );
  });

export const tasksLayer: Layer.Layer<Tasks, External, Converse> = Layer.effect(
  Tasks,
  Effect.gen(function* () {
    const converse = yield* Converse;
    yield* Effect.ignore(reapOrphans(converse));
    return tasksService(converse);
  }),
);
