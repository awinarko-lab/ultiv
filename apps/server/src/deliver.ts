/**
 * Delivery: the one path outside input rides into a session — webhook calls
 * and cron fires. It resolves the session's owner from the registry, admits
 * the text into the session's durable conversation, and settles it in the
 * background exactly like a typed input. Admission is the contract: once the
 * submission is durable, the caller succeeded — the TURN may still fail (no
 * provider, bad tool), and that is the session transcript's problem, not the
 * sender's.
 */
import { Effect } from "effect";
import type { MindService } from "@ultiv/mind";
import { ownerOfSession, touchSession } from "./sessions.ts";
import { sessionKey } from "./identity.ts";

export const deliverToSession = async (
  mind: MindService,
  sessionId: string,
  text: string,
): Promise<void> => {
  const owner = await ownerOfSession(mind, sessionId);
  const key = owner === undefined ? sessionId : sessionKey(owner, sessionId);
  const conversation = await Effect.runPromise(mind.converse.ensure(key));
  const submission = await Effect.runPromise(mind.converse.submit(conversation, text));
  await touchSession(mind, owner ?? "guest", sessionId, { at: Date.now(), titleSeed: text });
  void Effect.runPromise(mind.converse.settle(conversation, submission)).catch((cause) => {
    console.error("delivered turn failed:", cause);
  });
};
