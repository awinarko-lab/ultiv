/**
 * The Gate: a process-wide bound on concurrent model requests. N sessions
 * means N concurrent turns and scripts otherwise — the gateway answers bursts
 * with 429s. The gate wraps a `Models` instance's streaming entry points (the
 * `complete*` variants delegate to them), holding each request until a slot
 * frees. Methods are bound to the original instance: pi-ai's class keeps
 * private state, so proxies are out.
 */
import type { Api, Context, Model, Models } from "@earendil-works/pi-ai";

/** A promise-land counting semaphore (FIFO). */
export class Gate {
  private active = 0;
  private readonly limit: number;
  private readonly waiters: (() => void)[] = [];

  constructor(limit: number) {
    this.limit = limit;
  }

  get queued(): number {
    return this.waiters.length;
  }

  async hold<T>(run: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await run();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    this.waiters.shift()?.();
  }
}

type StreamFn = (model: Model<Api>, context: Context) => unknown;

/** Bind every own + prototype function of `models` to it, then gate the streams. */
export const gateModels = (models: Models, limit: number): Models => {
  const gate = new Gate(limit);
  const bound: Record<string, unknown> = {};
  for (const source of [models, Object.getPrototypeOf(models) as object]) {
    for (const key of Object.getOwnPropertyNames(source)) {
      const value = (models as unknown as Record<string, unknown>)[key];
      if (typeof value === "function")
        bound[key] = (value as (...args: unknown[]) => unknown).bind(models);
      else bound[key] = value;
    }
  }
  const gated =
    (stream: StreamFn): StreamFn =>
    (model, context) =>
      gate.hold(() => Promise.resolve(stream(model, context)));
  bound.stream = gated(models.stream.bind(models)) as unknown;
  bound.streamSimple = gated(models.streamSimple.bind(models)) as unknown;
  return bound as unknown as Models;
};
