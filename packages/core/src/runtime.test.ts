import { describe, expect, it } from "vite-plus/test";
import { Context, Effect, Layer } from "effect";
import { openRuntime } from "./runtime.ts";

describe("openRuntime", () => {
  it("builds a layer into a live service and runs finalizers on close", async () => {
    let released = false;
    class Probe extends Context.Service<Probe, { readonly n: number }>()("test/Probe") {}
    const layer = Layer.effect(
      Probe,
      Effect.acquireRelease(
        Effect.sync(() => ({ n: 42 })),
        () =>
          Effect.sync(() => {
            released = true;
          }),
      ),
    );
    const runtime = await openRuntime(layer, Probe);
    expect(runtime.service.n).toBe(42);
    expect(released).toBe(false);
    await runtime.close();
    expect(released).toBe(true);
  });
});
