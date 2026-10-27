/**
 * Background settling of a Session object's admitted inputs. An owner message
 * sent mid-turn steers the running turn (or waits for it, as a follow-up), so
 * several inputs can be in flight at once: the session reads "working" until
 * the last of them settles. A stopped turn or a withdrawn message settles
 * unanswered ("aborted") and is not an error.
 */
import type { Cell, Host } from "@earendil-works/chord";
import { isChordError } from "@earendil-works/chord";
import type { Conversation, Submission } from "@earendil-works/pi-durable";
import { Effect } from "effect";
import type {
  PendingApproval,
  Phase,
  ThinkingLevel,
  TranscriptEntry,
  UsageSummary,
} from "@ultiv/contracts";
import type { MindService } from "@ultiv/mind";
import type { Principal } from "./identity.ts";

export type SessionCells = {
  transcript: Cell<TranscriptEntry[]>;
  phase: Cell<Phase>;
  lastError: Cell<string | null>;
  pending: Cell<PendingApproval>;
  usage: Cell<UsageSummary>;
  model: Cell<string | null>;
  effort: Cell<ThinkingLevel | null>;
  conversationId: Cell<string | null>;
};

/** Cell write that survives object disposal: background turns may outlive the last reference. */
export function safeChange<T>(
  cell: Cell<T>,
  ctx: Parameters<Cell<T>["change"]>[0],
  fn: Parameters<Cell<T>["change"]>[1],
): void {
  try {
    cell.change(ctx, fn);
  } catch (error) {
    console.warn("cell write skipped:", isChordError(error) ? error.code : error);
  }
}

/** How many of this object's inputs are still unsettled; the session goes idle at zero. */
export class InFlight {
  #count = 0;
  start(): void {
    this.#count += 1;
  }
  /** One input settled; true when none is left. */
  finish(): boolean {
    this.#count = Math.max(0, this.#count - 1);
    return this.#count === 0;
  }
}

/** A stop or a withdrawal settles the input unanswered with reason "aborted". */
export const isStopped = (error: unknown): boolean => String(error).includes("abort");

export type SettleArgs = {
  readonly host: Host<Principal>;
  readonly mind: MindService;
  readonly conversation: Conversation;
  readonly submission: Submission;
  readonly owner: string;
  readonly sessionId: string;
  readonly cells: SessionCells;
  readonly inFlight: InFlight;
  readonly text: string;
};

/** Settles an admitted submission in the background; the transcript projection picks up the turn. */
export function settle(args: SettleArgs): void {
  const { host, mind, conversation, submission, cells, inFlight } = args;
  void host.root(async (ctx) => {
    try {
      const result = await Effect.runPromise(mind.converse.settle(conversation, submission));
      if (result.text.trim() !== "") {
        await mind.profiles.touchSession(args.owner, args.sessionId, {
          at: Date.now(),
          titleSeed: args.text,
        });
      }
      if (inFlight.finish()) safeChange(cells.phase, ctx, () => "idle");
    } catch (error) {
      const last = inFlight.finish();
      if (isStopped(error)) {
        if (last) safeChange(cells.phase, ctx, () => "idle");
        return;
      }
      console.error("agent turn failed:", error);
      safeChange(cells.lastError, ctx, () => String(error));
      safeChange(cells.phase, ctx, () => "error");
    }
  });
}
