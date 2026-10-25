import { Type, type Static } from "typebox";

/** One background task: an agent turn the entity runs in its own conversation. */
export const TaskStatusSchema = Type.Union([
  Type.Literal("running"),
  Type.Literal("done"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

export type TaskStatus = Static<typeof TaskStatusSchema>;

export const TaskInfoSchema = Type.Object({
  id: Type.String(),
  /** The app session the task belongs to (registry scoping; may be empty). */
  sessionId: Type.String(),
  /** Registry owner the task was spawned under (see /api/sessions owner scoping). */
  owner: Type.String(),
  /** The durable conversation that spawned the task; woken when it settles. Null for REST spawns. */
  conversationId: Type.Union([Type.String(), Type.Null()]),
  prompt: Type.String(),
  status: TaskStatusSchema,
  result: Type.Union([Type.String(), Type.Null()]),
  error: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.Number(),
  finishedAt: Type.Union([Type.Number(), Type.Null()]),
});

export type TaskInfo = Static<typeof TaskInfoSchema>;

export const TaskListSchema = Type.Array(TaskInfoSchema);

export type TaskList = Static<typeof TaskListSchema>;
