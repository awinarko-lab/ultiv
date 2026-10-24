import { randomUUID } from "node:crypto";
import type { Host } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineDoc, type Harness } from "@earendil-works/pi-durable";
import { Sessions, SessionListSchema, type SessionInfo } from "@ultiv/contracts";
import { ensureConversation } from "./session.ts";
import type { Principal } from "./main.ts";

/** Durable session registry (session doc singleton; SQLite-backed). */
const SessionsDoc = defineDoc<{ sessions: SessionInfo[] }>({
  kind: "ultiv.sessions",
  version: 1,
  scope: "session",
  initial: () => ({ sessions: [] }),
  checkpointWhen: () => true,
});

function titleFor(seed: string): string {
  const text = seed.trim();
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

/** Record last activity for a chat id, registering it on first contact (legacy ids included). */
export async function touchSession(
  harness: Harness,
  chatId: string,
  info: { at: number; titleSeed?: string },
): Promise<void> {
  await harness.commit(async (tx) => {
    const draft = await tx.doc(SessionsDoc);
    const sessions = [...draft.sessions];
    const index = sessions.findIndex((session) => session.id === chatId);
    if (index >= 0) {
      const current = sessions[index] as SessionInfo;
      sessions[index] = {
        ...current,
        lastMessageAt: info.at,
        title:
          current.title === "" && info.titleSeed !== undefined
            ? titleFor(info.titleSeed)
            : current.title,
      };
    } else {
      sessions.push({
        id: chatId,
        title: info.titleSeed !== undefined ? titleFor(info.titleSeed) : chatId,
        createdAt: info.at,
        lastMessageAt: info.at,
      });
    }
    draft.sessions = sessions;
  }, BACKGROUND_CONTEXT);
}

/** Registers the durable registry of chat sessions (one per host). */
export function serveSessions(host: Host<Principal>, harness: Harness): void {
  host.serve(Sessions, (_input, _principal, self) => {
    const sessions = self.state("sessions", SessionListSchema, {
      init: async () => (await harness.snapshot(SessionsDoc, BACKGROUND_CONTEXT))?.sessions ?? [],
    });
    return {
      variant: "default",
      sessions,
      create: async ({ title }, ctx) => {
        const id = randomUUID();
        const at = Date.now();
        await ensureConversation(harness, id);
        await harness.commit(async (tx) => {
          const draft = await tx.doc(SessionsDoc);
          draft.sessions = [
            ...draft.sessions,
            {
              id,
              title: title ?? "",
              createdAt: at,
              lastMessageAt: at,
            },
          ];
        }, BACKGROUND_CONTEXT);
        sessions.change(ctx, (current) => [
          ...current,
          {
            id,
            title: title ?? "",
            createdAt: at,
            lastMessageAt: at,
          },
        ]);
        return { id };
      },
    };
  });
}
