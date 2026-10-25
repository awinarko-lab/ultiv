import { randomUUID } from "node:crypto";
import type { Host } from "@earendil-works/chord";
import { defineDoc } from "@earendil-works/pi-durable";
import { Effect } from "effect";
import { Sessions, ModelListSchema, SessionListSchema, type SessionInfo } from "@ultiv/contracts";
import { KENARI_MODELS, type MindService } from "@ultiv/mind";
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

/**
 * Process-local mirror of the durable registry. Cells sync-init from it so a
 * fresh object's snapshot already carries the whole list: a publication racing
 * the client's subscribe handshake trips chord's ack window over the wire
 * (`ack N outside 0..N`) and desyncs the link, so nothing may publish at
 * attach. Mutations update the mirror first, then the live cell.
 */
let mirror: SessionInfo[] = [];

/** Prime the mirror from the durable registry. Runs once at stack build. */
export async function loadSessionCache(mind: MindService): Promise<void> {
  const stored = await Effect.runPromise(mind.converse.docs.snapshot(SessionsDoc));
  mirror = stored?.sessions ?? [];
}

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
  mirror = await readMirror(mind);
}

const readMirror = async (mind: MindService): Promise<SessionInfo[]> => {
  const stored = await Effect.runPromise(mind.converse.docs.snapshot(SessionsDoc));
  return stored?.sessions ?? [];
};

/** Registers the durable registry of chat sessions (one per host). */
export function serveSessions(host: Host<Principal>, mind: MindService): void {
  host.serve(Sessions, (_input, _principal, self) => {
    const sessions = self.state("sessions", SessionListSchema, mirror);
    const models = self.state(
      "models",
      ModelListSchema,
      KENARI_MODELS.map((spec) => ({
        id: spec.id,
        label: spec.label,
        efforts: [...spec.efforts],
        defaultEffort: spec.defaultEffort,
      })),
    );
    return {
      variant: "default",
      sessions,
      models,
      create: async ({ title }, ctx) => {
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
        mirror = await readMirror(mind);
        sessions.change(ctx, () => mirror);
        return { id };
      },
      remove: async ({ id }, ctx) => {
        // Removal is registry-level: the durable conversation stays in storage
        // (retention), the session just disappears from the list.
        await Effect.runPromise(
          mind.converse.docs.commit(async (tx) => {
            const draft = await tx.doc(SessionsDoc);
            draft.sessions = draft.sessions.filter((session) => session.id !== id);
          }),
        );
        mirror = await readMirror(mind);
        sessions.change(ctx, () => mirror);
        return { ok: true };
      },
    };
  });
}
