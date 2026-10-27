/**
 * Stop: the owner's hard abort. Queued inputs are withdrawn (each settles
 * unanswered), the running turn is aborted, and every approval card still
 * waiting is denied so a gated tool unwinds instead of holding the turn open.
 */
import type { Conversation } from "@earendil-works/pi-durable";
import { Effect } from "effect";
import type { ApprovalsService } from "../approvals.ts";
import type { ConverseService } from "./converse.ts";

export const stopTurn = async (
  converse: Pick<ConverseService, "interrupt">,
  approvals: Pick<ApprovalsService, "pendingFor" | "decide">,
  conversation: Conversation,
): Promise<void> => {
  const id = String(conversation.id);
  const denyAll = () => {
    for (const request of approvals.pendingFor(id)) approvals.decide(id, request.callId, false);
  };
  // Abort first (the signal is set synchronously), then release the gates the
  // abort waits on; deny again for any card that raced in meanwhile.
  const stopping = Effect.runPromise(converse.interrupt(conversation));
  denyAll();
  await stopping;
  denyAll();
};

/**
 * Whether a failed settle is a stop or a withdrawal rather than a fault: the
 * submission settled unanswered with reason "aborted". The reason rides in
 * the error's cause (`External`), not in its message.
 */
export const isStopped = (error: unknown): boolean => {
  const cause = (error as { cause?: unknown } | null)?.cause;
  return `${String(error)} ${typeof cause === "string" ? cause : String(cause)}`.includes("abort");
};
