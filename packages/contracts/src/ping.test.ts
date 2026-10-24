import { describe, expect, it } from "vite-plus/test";
import { Ping } from "./ping.ts";

describe("Ping contract", () => {
  it("is a remote contract, version 1, hosted on the server", () => {
    expect(Ping.scope).toBe("remote");
    expect(Ping.def.version).toBe(1);
  });

  it("declares its input schema", () => {
    expect(Ping.def.input).toMatchObject({ type: "object" });
  });

  it("declares the default variant with count state and an increment method", () => {
    const variant = Ping.def.variants.default;
    expect(variant).toBeDefined();
    expect(variant?.state).toMatchObject({ count: { type: "number" } });
    expect(variant?.methods).toMatchObject({ increment: expect.anything() });
  });
});
