import { describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";
import { Type } from "typebox";
import type { PromptSection } from "@earendil-works/pi-durable";
import { defineTool, type RegistryService } from "@ultiv/ext";
import { makeApprovals } from "../approvals.ts";
import { makeAudit } from "../audit/audit.ts";
import { actService } from "./act.ts";
import { ENTITY_NAME, identityPlugin, identitySection } from "./identity.ts";

const echo = defineTool({
  name: "echo",
  description: "Echo the input.",
  parameters: Type.Object({ text: Type.String() }),
  execute: async () => ({ output: [{ type: "text", text: "echo" }] }),
});

const registry = (
  tools: readonly ReturnType<typeof defineTool>[],
  sections: readonly PromptSection[] = [],
): RegistryService => ({
  register: () => Effect.succeed(undefined),
  plugins: () => [],
  tools: () => tools,
  sections: () => sections,
  connector: () => undefined,
});

describe("Act", () => {
  const audit = makeAudit("/dev/null");

  it("carries registry sections into the extension", () => {
    const act = actService(registry([echo], [identitySection()]), makeApprovals(), audit);
    const section = act.extension().sections?.[0];
    expect(section?.key).toBe("identity");
    expect(section?.render({} as never, {} as never)).toContain(`You are ${ENTITY_NAME}`);
  });

  it("gates flagged tools through the approval broker, reads stay clean", () => {
    const act = actService(
      registry([
        { ...echo, gated: true },
        { ...echo, name: "echo_read" },
      ]),
      makeApprovals(),
      audit,
    );
    expect(act.tools().map((tool) => tool.name)).toEqual(["echo", "echo_read"]);
    // The gated one is wrapped: its execute now consults the broker first.
    const gated = act.extension().tools?.find((tool) => tool.name === "echo");
    expect(gated?.execute).not.toBe(echo.execute);
  });
});

describe("Identity plugin", () => {
  it("declares the entity's name as a section capability", () => {
    const plugin = identityPlugin();
    expect(plugin.id).toBe("ultiv.mind.identity");
    const section = plugin.capabilities[0];
    expect(section?.kind).toBe("section");
    if (section?.kind !== "section") throw new Error("missing section capability");
    expect(section.section.render({} as never, {} as never)).toContain("You are Ultius");
  });
});
