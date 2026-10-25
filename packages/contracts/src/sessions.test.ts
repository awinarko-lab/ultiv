import { describe, expect, it } from "vite-plus/test";
import { ModelListSchema, SessionListSchema, SessionInfoSchema } from "./sessions.ts";

describe("Sessions REST payload schemas", () => {
  it("describe a flat session info record", () => {
    expect(SessionInfoSchema).toMatchObject({
      type: "object",
      required: ["id", "title", "createdAt", "lastMessageAt"],
    });
  });

  it("describe the list and model catalog payloads", () => {
    expect(SessionListSchema).toMatchObject({ type: "array" });
    expect(ModelListSchema).toMatchObject({ type: "array" });
  });
});
