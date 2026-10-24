import { describe, expect, it } from "vite-plus/test";
import { Session } from "./session.ts";

describe("Session contract", () => {
  it("is a remote contract, version 1, hosted on the server", () => {
    expect(Session.scope).toBe("remote");
    expect(Session.def.version).toBe(1);
  });

  it("is addressed per session id", () => {
    expect(Session.def.input).toMatchObject({
      type: "object",
      required: ["id"],
    });
  });

  it("declares transcript, phase and lastError state plus an input method", () => {
    const variant = Session.def.variants.default;
    expect(variant).toBeDefined();
    expect(variant?.state).toMatchObject({
      transcript: { type: "array" },
      phase: expect.anything(),
      lastError: expect.anything(),
    });
    expect(variant?.methods).toMatchObject({ input: expect.anything() });
  });
});
