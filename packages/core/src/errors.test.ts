import { describe, expect, it } from "vite-plus/test";
import { External, NotFound } from "./errors.ts";

describe("core errors", () => {
  it("carry stable ultiv tags", () => {
    expect(new NotFound({ what: "widget" })._tag).toBe("ultiv/NotFound");
    const cause = new Error("boom");
    const failure = new External({ op: "fetch", cause });
    expect(failure._tag).toBe("ultiv/External");
    expect(failure.cause).toBe(cause);
  });
});
