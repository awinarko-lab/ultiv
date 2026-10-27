/**
 * Approval broker between gated tool executions (harness background) and the
 * surface that shows them to the user. Keyed by conversation id — both sides
 * know it: tools get it from `ToolExecutionApi`, the object from the
 * conversation it created.
 *
 * Placement rule: approval gates ACTS, never ASKS. A tool that only consults
 * or computes (Jev scores, picks, ratings; search; fetch) is a READ — gating
 * it interrupts the loop while protecting nothing, because the act that uses
 * the result stays ungated. Wrap the side-effecting tool (send, write, pay,
 * delete) with `withApproval` instead; leave reads clean.
 */
import { Context, Deferred, Duration, Effect, Exit, Layer } from "effect";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { TSchema } from "typebox";

export interface ApprovalRequest {
  readonly callId: string;
  readonly name: string;
  readonly input: unknown;
}

/** Late-wired policy hooks: per-profile auto-approve and timeout escalation. */
export interface ApprovalsHooks {
  /** Return true to approve without waiting (policies.autoApprove). */
  readonly autoApprove?: (conversationId: string, request: ApprovalRequest) => boolean;
  /** Called when the wait timed out (policies.approvalTimeout escalation). */
  readonly onExpire?: (conversationId: string, request: ApprovalRequest) => void;
}

interface PendingEntry {
  readonly conversationId: string;
  readonly request: ApprovalRequest;
}

export interface ApprovalsService {
  /** Called by a gated tool: resolves once the user decides (or the timeout denies). */
  readonly request: (
    conversationId: string,
    callId: string,
    request: ApprovalRequest,
  ) => Effect.Effect<boolean>;
  /**
   * Called by the surface's `approve` method with the user's decision. An
   * optional `note` (a takeover, a reason) rides along and surfaces in the
   * tool's denial message via `noteFor`.
   */
  readonly decide: (
    conversationId: string,
    callId: string,
    approved: boolean,
    note?: string,
  ) => void;
  /** The decision note for this call, if any — read-once (the tool consumes it). */
  readonly noteFor: (conversationId: string, callId: string) => string | undefined;
  /** Snapshot of what is waiting for this conversation (empty: nothing). */
  readonly pendingFor: (conversationId: string) => readonly ApprovalRequest[];
  /** Every pending approval across conversations — the cross-profile inbox. */
  readonly pendingAll: () => ReadonlyArray<PendingEntry>;
  /** Wire the policy hooks (called once profiles exist). */
  readonly setHooks: (hooks: ApprovalsHooks) => void;
}

export class Approvals extends Context.Service<Approvals, ApprovalsService>()(
  "ultiv/mind/Approvals",
) {}

export const makeApprovals = (
  timeout: Duration.Duration = Duration.seconds(120),
): ApprovalsService => {
  const pending = new Map<string, PendingEntry>();
  const waiters = new Map<string, Deferred.Deferred<boolean>>();
  const notes = new Map<string, string>();
  let hooks: ApprovalsHooks = {};
  const key = (conversationId: string, callId: string): string => `${conversationId}:${callId}`;
  const settle = (k: string, approved: boolean): void => {
    const waiter = waiters.get(k);
    if (waiter === undefined) return;
    waiters.delete(k);
    pending.delete(k);
    Deferred.doneUnsafe(waiter, Effect.succeed(approved));
  };
  return {
    setHooks: (next) => {
      hooks = next;
    },
    request: (conversationId, callId, request) =>
      Effect.gen(function* () {
        if (hooks.autoApprove?.(conversationId, request) === true) return true;
        const k = key(conversationId, callId);
        notes.delete(k); // a stale note must not leak into this call's denial
        const deferred = yield* Deferred.make<boolean>();
        pending.set(k, { conversationId, request });
        waiters.set(k, deferred);
        const exit = yield* Effect.exit(Deferred.await(deferred).pipe(Effect.timeout(timeout)));
        if (Exit.isFailure(exit)) hooks.onExpire?.(conversationId, request);
        settle(k, Exit.isSuccess(exit));
        return Exit.isSuccess(exit) ? exit.value : false;
      }),
    decide: (conversationId, callId, approved, note) => {
      const k = key(conversationId, callId);
      if (note !== undefined && !approved) notes.set(k, note);
      settle(k, approved);
    },
    noteFor: (conversationId, callId) => {
      const k = key(conversationId, callId);
      const note = notes.get(k);
      notes.delete(k);
      return note;
    },
    pendingFor: (conversationId) => {
      const prefix = `${conversationId}:`;
      return [...pending].filter(([k]) => k.startsWith(prefix)).map(([, entry]) => entry.request);
    },
    pendingAll: () => [...pending.values()],
  };
};

export const approvalsLayer: Layer.Layer<Approvals> = Layer.succeed(Approvals, makeApprovals());

/**
 * Wrap a side-effecting tool so its execution waits for the user's approval
 * first. This is the ONLY way a tool should gate: one seam, applied at the
 * act. Reads must not be wrapped.
 */
export const withApproval = <TParameters extends TSchema>(
  approvals: ApprovalsService,
  tool: ToolRegistration<TParameters>,
): ToolRegistration<TParameters> => ({
  ...tool,
  execute: async (args, api, context) => {
    const conversationId = String(api.conversationId);
    const approved = await Effect.runPromise(
      approvals.request(conversationId, api.callId, {
        callId: api.callId,
        name: tool.name,
        input: args,
      }),
    );
    if (!approved) {
      const note = approvals.noteFor(conversationId, api.callId);
      return {
        isError: true,
        output: [
          {
            type: "text",
            text:
              note ??
              "not approved (the owner denied it, stopped the turn, or did not answer in time) — do not retry; tell the owner what was not done",
          },
        ],
      };
    }
    return tool.execute(args, api, context);
  },
});
