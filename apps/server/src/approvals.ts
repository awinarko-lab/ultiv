/**
 * Approval broker between gated tool executions (harness background) and the
 * Session object that surfaces them to the user. Keyed by conversation id —
 * both sides know it: tools get it from `ToolExecutionApi`, the object from
 * the conversation it created.
 */

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
