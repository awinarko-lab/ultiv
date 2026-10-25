/**
 * Approval broker between gated tool executions (harness background) and the
 * Session object that surfaces them to the user. Keyed by conversation id —
 * both sides know it: tools get it from `ToolExecutionApi`, the object from
 * the conversation it created.
 *
 * Placement rule: approval gates ACTS, never ASKS. A tool that only consults
 * or computes (Jev scores, picks, rates; search; fetch) is a read — gating it
 * interrupts the loop while protecting nothing, because the act that uses the
 * result stays ungated. Wrap the side-effecting tool (send, write, pay,
 * delete) with `withApproval` instead; leave reads clean.
 */

import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { TSchema } from "typebox";

export type ApprovalRequest = {
  callId: string;
  name: string;
  input: unknown;
};

const pending = new Map<string, ApprovalRequest>();
const waiters = new Map<string, (approved: boolean) => void>();

function key(conversationId: string, callId: string): string {
  return `${conversationId}:${callId}`;
}

/** Called by a gated tool: resolves once the user decides (or the timeout denies). */
export function requestApproval(
  conversationId: string,
  callId: string,
  request: ApprovalRequest,
): Promise<boolean> {
  const k = key(conversationId, callId);
  pending.set(k, request);
  return new Promise<boolean>((resolve) => {
    waiters.set(k, resolve);
    setTimeout(() => {
      if (waiters.has(k)) {
        waiters.delete(k);
        pending.delete(k);
        resolve(false);
      }
    }, 120_000);
  });
}

/** Called by the Session's `approve` method with the user's decision. */
export function decideApproval(conversationId: string, callId: string, approved: boolean): void {
  const k = key(conversationId, callId);
  const resolve = waiters.get(k);
  if (resolve === undefined) return;
  waiters.delete(k);
  pending.delete(k);
  resolve(approved);
}

/** Snapshot of what is waiting for this conversation (empty: nothing). */
export function pendingFor(conversationId: string): ApprovalRequest[] {
  const prefix = `${conversationId}:`;
  return [...pending].filter(([k]) => k.startsWith(prefix)).map(([, request]) => request);
}

/**
 * Wrap a side-effecting tool so its execution waits for the user's approval
 * first. This is the ONLY way a tool should gate: one seam, applied at the
 * act. Reads must not be wrapped.
 */
export function withApproval<P extends TSchema>(tool: ToolRegistration<P>): ToolRegistration<P> {
  return {
    ...tool,
    execute: async (args, api, context) => {
      const approved = await requestApproval(String(api.conversationId), api.callId, {
        callId: api.callId,
        name: tool.name,
        input: args,
      });
      if (!approved) {
        return {
          isError: true,
          output: [{ type: "text", text: "denied by the user" }],
        };
      }
      return tool.execute(args, api, context);
    },
  };
}
