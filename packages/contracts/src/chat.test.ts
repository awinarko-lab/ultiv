import { describe, expect, it } from "vite-plus/test";
import { Chat } from "./chat.ts";

describe("Chat contract", () => {
  it("is a remote contract, version 2, hosted on the server", () => {
    expect(Chat.scope).toBe("remote");
    expect(Chat.def.version).toBe(2);
  });

  it("is addressed per conversation id", () => {
    expect(Chat.def.input).toMatchObject({
      type: "object",
      required: ["id"],
    });
  });

  it("declares messages, turn and lastError state plus a send method", () => {
    const variant = Chat.def.variants.default;
    expect(variant).toBeDefined();
    expect(variant?.state).toMatchObject({
      messages: { type: "array" },
      turn: expect.anything(),
      lastError: expect.anything(),
    });
    expect(variant?.methods).toMatchObject({ send: expect.anything() });
  });
});
