import { describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";
import { Type } from "typebox";
import { defineTool, type RegistryService } from "@ultiv/ext";
import { makeApprovals } from "../approvals.ts";
import { actService, ENTITY_NAME, identitySection } from "./act.ts";

const echo = defineTool({
  name: "echo",
  description: "Echo the input.",
  parameters: Type.Object({ text: Type.String() }),
  execute: async () => ({ output: [{ type: "text", text: "echo" }] }),
});

const registry = (tools: readonly ReturnType<typeof defineTool>[]): RegistryService => ({
  register: () => Effect.succeed(undefined),
  plugins: () => [],
  tools: () => tools,
  connector: () => undefined,
});

describe("Act", () => {
  it("carries the entity's identity into every system prompt", () => {
    const act = actService(registry([echo]), makeApprovals());
    const section = act.extension().sections?.[0];
    expect(section?.key).toBe("identity");
    expect(section?.render({} as never, {} as never)).toBe(`You are ${ENTITY_NAME}.`);
  });

  it("gates flagged tools through the approval broker, reads stay clean", () => {
    const act = actService(
      registry([
        { ...echo, gated: true },
        { ...echo, name: "echo_read" },
      ]),
      makeApprovals(),
    );
    expect(act.tools().map((tool) => tool.name)).toEqual(["echo", "echo_read"]);
    // The gated one is wrapped: its execute now consults the broker first.
    const gated = act.extension().tools?.find((tool) => tool.name === "echo");
    expect(gated?.execute).not.toBe(echo.execute);
  });

  it("exposes the identity section builder standalone", () => {
    expect(identitySection().render({} as never, {} as never)).toBe("You are Ultius.");
  });
});
