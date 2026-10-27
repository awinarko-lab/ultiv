/** Loopback HTTP servers for broker tests: each records what it received. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface Seen {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingMessage["headers"];
  readonly body: string;
}

export interface TestServer {
  readonly port: number;
  readonly seen: Seen[];
  readonly close: () => Promise<void>;
}

export const startServer = async (
  handle: (seen: Seen, res: ServerResponse) => void,
): Promise<TestServer> => {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const entry = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      seen.push(entry);
      handle(entry, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    seen,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
};
