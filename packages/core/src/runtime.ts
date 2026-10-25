/**
 * The promise-land door into Effect-land: builds a fully-provided Layer into a
 * live service under a scope the caller owns. The server, the probe, and every
 * future long-lived runtime enter the core through here — the scope's
 * finalizers (durable harness, sockets) run on `close()`.
 */
import { Context, Effect, Exit, Layer, Scope } from "effect";

export interface Runtime<S> {
  readonly service: S;
  /** Runs the layer scope's finalizers. */
  readonly close: () => Promise<void>;
}

/**
 * Build a layer with no remaining requirements into a live, closeable service.
 * `key` extracts the service from the built context (pass the service's
 * `Context.Service` class).
 */
export const openRuntime = <I, S, E>(
  layer: Layer.Layer<I, E, never>,
  key: Context.Key<I, S>,
): Promise<Runtime<S>> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(layer, scope);
    return {
      service: Context.get(context, key),
      close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
    };
  }).pipe(Effect.runPromise);
