import type { WhenBusy } from "@ultiv/contracts";

/** What a queued chip says about when its message reaches the bot. */
export function queueLabel(mode: WhenBusy, approvalPending: boolean): string {
  if (approvalPending) return "Waiting for your approval first";
  return mode === "steer" ? "Will send at the next step" : "Will send after it finishes";
}
