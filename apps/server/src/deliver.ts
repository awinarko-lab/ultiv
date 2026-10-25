/**
 * Delivery: the one path outside input rides into a session — webhook calls,
 * cron fires, mailbox envelopes. It resolves the session's registry row (and
 * with it the owner and profile scope), admits the text into the session's
 * durable conversation, and settles it in the background exactly like a typed
 * input. Admission is the contract: once the submission is durable, the caller
 * succeeded — the TURN may still fail (no provider, bad tool), and that is the
 * session transcript's problem, not the sender's.
 */
import { Effect } from "effect";
import type { MindService } from "@ultiv/mind";

export const deliverToSession = async (
  mind: MindService,
  sessionId: string,
  text: string,
): Promise<void> => {
  const row = await mind.profiles.rowOf(sessionId);
  const owner = row?.owner;
  const key =
    row !== undefined
      ? await mind.profiles.keyOfRow(row)
      : owner !== undefined
        ? await mind.profiles.keyForSession(owner, sessionId)
        : sessionId; // pre-registry ids: the raw key, exactly as before
  const conversation = await Effect.runPromise(mind.converse.ensure(key));
  const submission = await Effect.runPromise(mind.converse.submit(conversation, text));
  await mind.profiles.touchSession(owner ?? "guest", sessionId, {
    at: Date.now(),
    titleSeed: text,
  });
  void Effect.runPromise(mind.converse.settle(conversation, submission)).catch((cause) => {
    console.error("delivered turn failed:", cause);
  });
};
