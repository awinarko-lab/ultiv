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

export interface ApprovalsService {
  /** Called by a gated tool: resolves once the user decides (or the timeout denies). */
  readonly request: (
    conversationId: string,
    callId: string,
    request: ApprovalRequest,
  ) => Effect.Effect<boolean>;
  /** Called by the surface's `approve` method with the user's decision. */
  readonly decide: (conversationId: string, callId: string, approved: boolean) => void;
  /** Snapshot of what is waiting for this conversation (empty: nothing). */
  readonly pendingFor: (conversationId: string) => readonly ApprovalRequest[];
}

export class Approvals extends Context.Service<Approvals, ApprovalsService>()(
  "ultiv/mind/Approvals",
) {}

export const makeApprovals = (
  timeout: Duration.Duration = Duration.seconds(120),
): ApprovalsService => {
  const pending = new Map<string, ApprovalRequest>();
  const waiters = new Map<string, Deferred.Deferred<boolean>>();
  const key = (conversationId: string, callId: string): string => `${conversationId}:${callId}`;
  const settle = (k: string, approved: boolean): void => {
    const waiter = waiters.get(k);
    if (waiter === undefined) return;
    waiters.delete(k);
    pending.delete(k);
    Deferred.doneUnsafe(waiter, Effect.succeed(approved));
  };
  return {
    request: (conversationId, callId, request) =>
      Effect.gen(function* () {
        const k = key(conversationId, callId);
        const deferred = yield* Deferred.make<boolean>();
        pending.set(k, request);
        waiters.set(k, deferred);
        const exit = yield* Effect.exit(Deferred.await(deferred).pipe(Effect.timeout(timeout)));
        settle(k, Exit.isSuccess(exit));
        return Exit.isSuccess(exit) ? exit.value : false;
      }),
    decide: (conversationId, callId, approved) => settle(key(conversationId, callId), approved),
    pendingFor: (conversationId) => {
      const prefix = `${conversationId}:`;
      return [...pending].filter(([k]) => k.startsWith(prefix)).map(([, request]) => request);
    },
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
    const approved = await Effect.runPromise(
      approvals.request(String(api.conversationId), api.callId, {
        callId: api.callId,
        name: tool.name,
        input: args,
      }),
    );
    if (!approved) {
      return { isError: true, output: [{ type: "text", text: "denied by the user" }] };
    }
    return tool.execute(args, api, context);
  },
});
