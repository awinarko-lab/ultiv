import { randomUUID } from "node:crypto";
import { defineDoc } from "@earendil-works/pi-durable";
import { Effect } from "effect";
import { Type } from "typebox";
import type { SessionInfo } from "@ultiv/contracts";
import type { MindService } from "@ultiv/mind";

/** Durable session registry (session doc singleton; SQLite-backed). */
const SessionsDoc = defineDoc<{ sessions: SessionInfo[] }>({
  kind: "ultiv.sessions",
  version: 2,
  scope: "session",
  initial: () => ({ sessions: [] }),
  // v1 rows predate owner scoping; they belonged to whoever used the server,
  // which is exactly what "guest" now means.
  migrate: (value) => {
    const stored = (value.sessions ?? []) as unknown as ReadonlyArray<Record<string, unknown>>;
    const sessions = stored.map((row) => ({
      ...row,
      owner: typeof row.owner === "string" ? row.owner : "guest",
    }));
    return { sessions } as unknown as { sessions: SessionInfo[] };
  },
  checkpointWhen: () => true,
});

const TitleSchema = Type.Object({ title: Type.String() });

function titleFor(seed: string): string {
  const text = seed.trim();
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

/**
 * A short title for a conversation's first message, through the generate
 * faculty. Falls back to truncation on ANY failure — a title is a nicety,
 * never a dependency.
 */
export async function titleForSeed(mind: MindService, seed: string): Promise<string> {
  try {
    const generated = await Effect.runPromise(
      mind.generate.extract({ schema: TitleSchema, maxTokens: 64, prompt: titlePrompt(seed) }),
    );
    const title = generated.title.trim().slice(0, 80);
    return title === "" ? titleFor(seed) : title;
  } catch {
    return titleFor(seed);
  }
}

const titlePrompt = (seed: string): string =>
  `Write a 3-6 word title for a conversation that starts with the message below. ` +
  `Reply as JSON {"title": "..."}.\n\n<message>\n${seed.slice(0, 500)}\n</message>`;

const readRegistry = async (mind: MindService): Promise<SessionInfo[]> => {
  const stored = await Effect.runPromise(mind.converse.docs.snapshot(SessionsDoc));
  return stored?.sessions ?? [];
};

/** One owner's sessions, for `GET /api/sessions`. */
export const listSessions = async (mind: MindService, owner: string): Promise<SessionInfo[]> =>
  (await readRegistry(mind)).filter((session) => session.owner === owner);

/** Create a session (durable conversation + registry entry); returns its info. */
export const createSession = async (
  mind: MindService,
  owner: string,
  title: string | null,
): Promise<SessionInfo> => {
  const id = randomUUID();
  const at = Date.now();
  await Effect.runPromise(mind.converse.ensure(`${owner}:${id}`));
  await Effect.runPromise(
    mind.converse.docs.commit(async (tx) => {
      const draft = await tx.doc(SessionsDoc);
      draft.sessions = [
        ...draft.sessions,
        {
          id,
          owner,
          title: title ?? "",
          createdAt: at,
          lastMessageAt: at,
        },
      ];
    }),
  );
  return { id, owner, title: title ?? "", createdAt: at, lastMessageAt: at };
};

/**
 * Remove a session from the registry, for `DELETE /api/sessions/:id`.
 * Owner-scoped: another owner's id is simply not there. Registry-level only —
 * the durable conversation stays in storage (retention).
 */
export const removeSession = async (
  mind: MindService,
  owner: string,
  id: string,
): Promise<boolean> => {
  await Effect.runPromise(
    mind.converse.docs.commit(async (tx) => {
      const draft = await tx.doc(SessionsDoc);
      draft.sessions = draft.sessions.filter(
        (session) => !(session.id === id && session.owner === owner),
      );
    }),
  );
  return true;
};

/** The owner a session id is registered under; undefined when unknown. */
export const ownerOfSession = async (mind: MindService, id: string): Promise<string | undefined> =>
  (await readRegistry(mind)).find((session) => session.id === id)?.owner;

/** Record last activity for a chat id, registering it on first contact (legacy ids included). */
export async function touchSession(
  mind: MindService,
  owner: string,
  chatId: string,
  info: { at: number; titleSeed?: string },
): Promise<void> {
  const title = info.titleSeed !== undefined ? await titleForSeed(mind, info.titleSeed) : undefined;
  await Effect.runPromise(
    mind.converse.docs.commit(async (tx) => {
      const draft = await tx.doc(SessionsDoc);
      const sessions = [...draft.sessions];
      const index = sessions.findIndex(
        (session) => session.id === chatId && session.owner === owner,
      );
      if (index >= 0) {
        const current = sessions[index] as SessionInfo;
        sessions[index] = {
          ...current,
          lastMessageAt: info.at,
          title: current.title === "" && title !== undefined ? title : current.title,
        };
      } else {
        sessions.push({
          id: chatId,
          owner,
          title: title ?? chatId,
          createdAt: info.at,
          lastMessageAt: info.at,
        });
      }
      draft.sessions = sessions;
    }),
  );
}
