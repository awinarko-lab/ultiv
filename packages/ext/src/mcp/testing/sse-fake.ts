/**
 * Test-only legacy HTTP+SSE server transport (protocol 2024-11-05): the GET
 * stream first sends an `endpoint` event naming the POST URL; responses and
 * notifications go back down the stream as `message` events.
 */
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { Transport } from "@modelcontextprotocol/server";

type Message = Parameters<NonNullable<Transport["onmessage"]>>[0];

export interface SseSession extends Transport {
  readonly sessionId: string;
  readonly receive: (message: Message) => void;
}

export const makeSseSession = (
  res: ServerResponse,
  endpointFor: (sessionId: string) => string,
): SseSession => {
  const sessionId = randomUUID();
  let closed = false;
  const session: SseSession = {
    sessionId,
    start: async () => {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(`event: endpoint\ndata: ${endpointFor(sessionId)}\n\n`);
      res.on("close", () => {
        if (closed) return;
        closed = true;
        session.onclose?.();
      });
    },
    send: async (message) => {
      if (!closed) res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      res.end();
      session.onclose?.();
    },
    receive: (message) => session.onmessage?.(message),
  };
  return session;
};
