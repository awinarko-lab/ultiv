/**
 * The Gate: a process-wide bound on concurrent model requests. N sessions
 * means N concurrent turns and scripts otherwise — the gateway answers bursts
 * with 429s.
 *
 * Contract care: `Models.stream/streamSimple` return the event stream
 * SYNCHRONOUSLY and the harness consumes it with
 * `for await (const event of events)` — wrapping the CALL in a Promise breaks
 * that (a Promise is not async-iterable; that faulted every live turn once).
 * So the slot wraps CONSUMPTION instead: `result()` and each full iteration,
 * which is exactly the lifetime of one provider request. The gated methods
 * are also shadowed onto the instance, so pi-ai's `complete/completeSimple`
 * (which call `this.stream*` internally — the harness compacts through
 * `completeSimple`) pass through the gate as well. Everything stays bound to
 * the original instance: pi-ai's class keeps private state, so receivers
 * must not change.
 */
import type {
  AssistantMessageEventStream,
  Api,
  Context,
  Model,
  Models,
} from "@earendil-works/pi-ai";

/** A promise-land counting semaphore (FIFO). */
export class Gate {
  private activeCount = 0;
  private readonly limit: number;
  private readonly waiters: (() => void)[] = [];

  constructor(limit: number) {
    this.limit = limit;
  }

  get queued(): number {
    return this.waiters.length;
  }

  get active(): number {
    return this.activeCount;
  }

  async acquire(): Promise<void> {
    if (this.activeCount < this.limit) {
      this.activeCount += 1;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.activeCount += 1;
        resolve();
      });
    });
  }

  release(): void {
    this.activeCount -= 1;
    this.waiters.shift()?.();
  }

  async hold<T>(run: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await run();
    } finally {
      this.release();
    }
  }
}

type AnyStream = (
  model: Model<Api>,
  context: Context,
  options?: unknown,
) => AssistantMessageEventStream;

type Consumable = AsyncIterable<unknown> & { readonly result: () => Promise<unknown> };

/** Bind every own + prototype function of `models` to it, then gate the streams. */
export const gateModels = (models: Models, limit: number): Models => {
  const gate = new Gate(limit);
  const bound: Record<string, unknown> = {};
  for (const source of [models, Object.getPrototypeOf(models) as object]) {
    for (const key of Object.getOwnPropertyNames(source)) {
      const value = (models as unknown as Record<string, unknown>)[key];
      if (typeof value === "function") {
        bound[key] = (value as (...args: unknown[]) => unknown).bind(models);
      } else bound[key] = value;
    }
  }
  // Forward every property to the original (bound to it: private fields);
  // the slot wraps `result` and each full iteration.
  const consume = (events: Consumable): AssistantMessageEventStream =>
    new Proxy(events, {
      get(target, prop) {
        if (prop === Symbol.asyncIterator) {
          return () =>
            (async function* () {
              await gate.acquire();
              try {
                yield* target;
              } finally {
                gate.release();
              }
            })();
        }
        if (prop === "result") return () => gate.hold(() => target.result());
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as AssistantMessageEventStream;
  const streamOriginal = models.stream.bind(models) as AnyStream;
  const streamSimpleOriginal = models.streamSimple.bind(models) as AnyStream;
  const gated =
    (original: AnyStream): AnyStream =>
    (model, context, options) =>
      consume(original(model, context, options) as unknown as Consumable);
  bound.stream = gated(streamOriginal);
  bound.streamSimple = gated(streamSimpleOriginal);
  // Instance shadow: internal `this.stream*` calls (complete/completeSimple)
  // resolve through the gate too.
  const writable = models as unknown as Record<string, unknown>;
  writable.stream = bound.stream;
  writable.streamSimple = bound.streamSimple;
  return bound as unknown as Models;
};
