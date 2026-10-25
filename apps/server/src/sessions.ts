import { randomUUID } from "node:crypto";
import { defineDoc } from "@earendil-works/pi-durable";
import { Effect } from "effect";
import type { SessionInfo } from "@ultiv/contracts";
import type { MindService } from "@ultiv/mind";

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

const readRegistry = async (mind: MindService): Promise<SessionInfo[]> => {
  const stored = await Effect.runPromise(mind.converse.docs.snapshot(SessionsDoc));
  return stored?.sessions ?? [];
};

/** The full registry, for `GET /api/sessions`. */
export const listSessions = (mind: MindService): Promise<SessionInfo[]> => readRegistry(mind);

/** Create a session (durable conversation + registry entry); returns its info. */
export const createSession = async (
  mind: MindService,
  title: string | null,
): Promise<SessionInfo> => {
  const id = randomUUID();
  const at = Date.now();
  await Effect.runPromise(mind.converse.ensure(id));
  await Effect.runPromise(
    mind.converse.docs.commit(async (tx) => {
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
    }),
  );
  return { id, title: title ?? "", createdAt: at, lastMessageAt: at };
};

/**
 * Remove a session from the registry, for `DELETE /api/sessions/:id`.
 * Registry-level: the durable conversation stays in storage (retention).
 */
export const removeSession = async (mind: MindService, id: string): Promise<boolean> => {
  await Effect.runPromise(
    mind.converse.docs.commit(async (tx) => {
      const draft = await tx.doc(SessionsDoc);
      draft.sessions = draft.sessions.filter((session) => session.id !== id);
    }),
  );
  return true;
};

/** Record last activity for a chat id, registering it on first contact (legacy ids included). */
export async function touchSession(
  mind: MindService,
  chatId: string,
  info: { at: number; titleSeed?: string },
): Promise<void> {
  await Effect.runPromise(
    mind.converse.docs.commit(async (tx) => {
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
    }),
  );
}
