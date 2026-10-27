/**
 * Waking a sender: submit a signal into a conversation and settle it in the
 * background. Bursts COALESCE: envelopes arriving for the same conversation
 * within the window ride one wake (joined by a separator), so a bot hit with
 * five messages wakes once, not five times. Follow-up policy — a mailbox
 * signal never derails a turn in flight. Each wake names the entries it
 * carries: once it is admitted they are marked notified, and the request id
 * makes a re-sent wake after a restart land only once.
 */
import type { ConverseService } from "../converse/converse.ts";
import { run } from "./store.ts";

export interface WakeQueue {
  readonly wake: (conversationId: string, text: string, entryId?: string) => void;
}

export const wakeRequestId = (entryId: string): string => `mailbox-wake:${entryId}`;

export const wakeQueue = (
  converse: ConverseService,
  /** Called once a wake is admitted, with the entries it carried. */
  onAdmitted: (entryIds: readonly string[]) => Promise<void>,
): WakeQueue => {
  const pending = new Map<string, { texts: string[]; ids: string[] }>();
  const debounceMs = Number(process.env.MAILBOX_WAKE_DEBOUNCE_MS ?? 8_000);
  const flush = async (conversationId: string, texts: string[], ids: string[]): Promise<void> => {
    try {
      const chat = await run(converse.open(conversationId));
      if (chat === undefined) return;
      const first = ids[0];
      const submission = await run(
        converse.submit(
          chat,
          texts.join("\n\n---\n\n"),
          "followUp",
          first === undefined ? undefined : wakeRequestId(first),
        ),
      );
      await onAdmitted(ids).catch((cause: unknown) => {
        console.error("mailbox wake bookkeeping failed:", cause);
      });
      void run(converse.settle(chat, submission)).catch(() => undefined);
    } catch (cause) {
      console.error("mailbox wake failed:", cause);
    }
  };
  return {
    wake: (conversationId, text, entryId) => {
      const existing = pending.get(conversationId);
      if (existing !== undefined) {
        existing.texts.push(text);
        if (entryId !== undefined) existing.ids.push(entryId);
        return;
      }
      const batch = { texts: [text], ids: entryId === undefined ? [] : [entryId] };
      pending.set(conversationId, batch);
      setTimeout(() => {
        pending.delete(conversationId);
        void flush(conversationId, batch.texts, batch.ids);
      }, debounceMs).unref?.();
    },
  };
};
