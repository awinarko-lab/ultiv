/** Shared REST plumbing: route args and body/query helpers. */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { MindService } from "@ultiv/mind";
import type { CronScheduler } from "../cron.ts";

export interface RouteArgs {
  readonly mind: MindService;
  readonly scheduler: CronScheduler;
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly url: URL;
  readonly owner: string;
  readonly path: string;
  readonly json: (status: number, body: unknown) => void;
  readonly readJson: <T>(req: IncomingMessage) => Promise<T>;
  readonly readBody: (req: IncomingMessage) => Promise<Buffer>;
}

export const queryOr = (args: RouteArgs, key: string): string | undefined => {
  const value = args.url.searchParams.get(key);
  return value !== null && value.trim() !== "" ? value : undefined;
};

export const errorOf = (cause: unknown): string => {
  const error = cause as { reason?: string; what?: string };
  return error.reason ?? error.what ?? String(cause);
};
