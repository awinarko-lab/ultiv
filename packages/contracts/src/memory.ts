import { Type, type Static } from "typebox";

/**
 * One memory record. Scope `profile` = one entity's own durable facts (keyed
 * by profile id); scope `owner` = the user's cross-profile store (preferences
 * that must not be re-taught per entity). Write authority is config: entities
 * write about themselves; only the owner-designated memory keeper writes
 * owner memory.
 */
export const MemoryRecordSchema = Type.Object({
  id: Type.String(),
  scope: Type.Union([Type.Literal("profile"), Type.Literal("owner")]),
  /** The profile a profile-scope record belongs to; null for owner scope. */
  profile: Type.Union([Type.String(), Type.Null()]),
  text: Type.String(),
  tags: Type.Array(Type.String()),
  at: Type.Number(),
});

export type MemoryRecord = Static<typeof MemoryRecordSchema>;

export const MemoryListSchema = Type.Array(MemoryRecordSchema);

export type MemoryList = Static<typeof MemoryListSchema>;
