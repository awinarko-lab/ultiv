/**
 * MCP input schemas are plain JSON Schema from a third party. The harness
 * compiles them with TypeBox to validate arguments; a schema it cannot
 * compile (odd keywords, unresolved refs) falls back to a permissive object
 * so one bad tool never breaks a turn — the server still validates.
 */
import type { TSchema } from "typebox";
import { Compile } from "typebox/compile";

const permissive = (): TSchema =>
  ({ type: "object", properties: {}, additionalProperties: true }) as unknown as TSchema;

export const toolSchemaOf = (input: unknown): TSchema => {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return permissive();
  const schema: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  delete schema.$schema;
  schema.type = "object";
  const properties = schema.properties;
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) {
    schema.properties = {};
  }
  try {
    Compile(schema as unknown as TSchema);
    return schema as unknown as TSchema;
  } catch {
    return permissive();
  }
};
