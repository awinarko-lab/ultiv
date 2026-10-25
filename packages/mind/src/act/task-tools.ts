/**
 * The Tasks faculty as native tools of the agent loop (`task_spawn`,
 * `task_status`, `task_list`): the entity can hand background work to itself —
 * research, batch jobs, follow-ups — without holding a turn open. Spawning
 * work is internal compute, not a side effect on the world: ungated, like the
 * decision tools. Results are read back explicitly.
 */
import { Effect } from "effect";
import { Type } from "typebox";
import { definePlugin, toolCapability, type Plugin, type Tool } from "@ultiv/ext";
import { defineTool } from "@ultiv/ext";
import type { TasksService } from "../tasks/tasks.ts";

const SpawnParams = Type.Object({
  prompt: Type.String({
    description: "The full, self-contained instruction for the background task.",
  }),
  sessionId: Type.Optional(
    Type.String({ description: "App session to file the task under; optional." }),
  ),
});

const StatusParams = Type.Object({ id: Type.String({ description: "The task id." }) });

/** One tool reply, the two shapes the status tool produces. */
type StatusReply =
  | { output: { type: "text"; text: string }[]; isError: true }
  | {
      output: { type: "text"; text: string }[];
      structuredOutput: {
        status: string;
        result: string | null;
        error: string | null;
      };
    };

/** Agent-spawned tasks are filed under their own owner label. */
const AGENT_OWNER = "agent";

const spawnTool = (tasks: TasksService): Tool =>
  defineTool({
    name: "task_spawn",
    description:
      "Start a background task: your own sub-agent turn, run in its own durable conversation. " +
      "Use it for work that should not hold this conversation open; read the result back with task_status.",
    parameters: SpawnParams,
    structuredOutputSchema: Type.Object({ id: Type.String(), status: Type.String() }),
    execute: (args) =>
      Effect.runPromise(
        Effect.map(
          tasks.spawn({
            sessionId: args.sessionId ?? "",
            owner: AGENT_OWNER,
            prompt: args.prompt,
          }),
          (task) => ({
            output: [{ type: "text" as const, text: `task ${task.id} ${task.status}` }],
            structuredOutput: { id: task.id, status: task.status },
          }),
        ),
      ),
  });

const statusTool = (tasks: TasksService): Tool =>
  defineTool({
    name: "task_status",
    description: "Read a background task's status, result and error by id.",
    parameters: StatusParams,
    structuredOutputSchema: Type.Object({
      status: Type.String(),
      result: Type.Union([Type.String(), Type.Null()]),
      error: Type.Union([Type.String(), Type.Null()]),
    }),
    execute: (args) =>
      Effect.runPromise(
        Effect.flatMap(tasks.get(args.id), (task): Effect.Effect<StatusReply> => {
          if (task === undefined) {
            return Effect.succeed({
              output: [{ type: "text" as const, text: `unknown task: ${args.id}` }],
              isError: true,
            });
          }
          return Effect.succeed({
            output: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  status: task.status,
                  result: task.result,
                  error: task.error,
                }),
              },
            ],
            structuredOutput: {
              status: task.status,
              result: task.result,
              error: task.error,
            },
          });
        }),
      ),
  });

const listTool = (tasks: TasksService): Tool =>
  defineTool({
    name: "task_list",
    description: "List recent background tasks with their ids, prompts and statuses.",
    parameters: Type.Object({}),
    structuredOutputSchema: Type.Array(
      Type.Object({ id: Type.String(), prompt: Type.String(), status: Type.String() }),
    ),
    execute: () =>
      Effect.runPromise(
        Effect.map(tasks.list(), (list) => {
          const recent = list.slice(-20).reverse();
          return {
            output: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  recent.map((task) => ({
                    id: task.id,
                    prompt: task.prompt,
                    status: task.status,
                  })),
                ),
              },
            ],
            structuredOutput: recent.map((task) => ({
              id: task.id,
              prompt: task.prompt,
              status: task.status,
            })),
          };
        }),
      ),
  });

/** The task tools in registry order. */
export const taskTools = (tasks: TasksService): readonly Tool[] => [
  spawnTool(tasks),
  statusTool(tasks),
  listTool(tasks),
];

/** The mind's background-task faculty as an installable plugin. */
export const taskPlugin = (tasks: TasksService): Plugin =>
  definePlugin({
    id: "ultiv.mind.tasks",
    version: "1.0.0",
    description: "The mind's background tasks: spawn, track and read back its own sub-agent work.",
    capabilities: taskTools(tasks).map(toolCapability),
  });
