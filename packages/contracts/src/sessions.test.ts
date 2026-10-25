import { describe, expect, it } from "vite-plus/test";
import { Sessions } from "./sessions.ts";

describe("Sessions contract", () => {
  it("is a remote contract, version 2, hosted on the server", () => {
    expect(Sessions.scope).toBe("remote");
    expect(Sessions.def.version).toBe(2);
  });

  it("takes no input (one registry per host)", () => {
    expect(Sessions.def.input).toMatchObject({ type: "object" });
    expect(Sessions.def.input.required ?? []).toEqual([]);
  });

  it("declares a sessions list, a model catalog, and create/remove methods", () => {
    const variant = Sessions.def.variants.default;
    expect(variant).toBeDefined();
    expect(variant?.state).toMatchObject({
      sessions: { type: "array" },
      models: { type: "array" },
    });
    expect(variant?.methods).toMatchObject({
      create: expect.anything(),
      remove: expect.anything(),
    });
  });
});
