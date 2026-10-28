/**
 * Test-only HTTP fakes on one port: Streamable HTTP at /mcp (stateful
 * sessions, so list_changed reaches the client), legacy HTTP+SSE at
 * /sse + /messages (hand-written: the v2 server SDK ships none), optional
 * static bearer auth, and an OAuth 2.1 authorization server (PRM, AS
 * metadata, DCR, PKCE S256, refresh) guarding /mcp.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { makeFakeServer } from "./fake-server.ts";
import { makeFakeAuth, type FakeAuth } from "./oauth-fake.ts";
import { makeSseSession, type SseSession } from "./sse-fake.ts";

export interface HttpFakeOptions {
  /** Require `Authorization: Bearer <token>` on /mcp and /sse. */
  readonly bearer?: string;
  /** Guard /mcp with the fake OAuth server. */
  readonly oauth?: boolean;
  /** The token endpoint requires this client secret (confidential clients). */
  readonly oauthRequireSecret?: string;
  /** Serve only legacy SSE: POST /sse answers 405 (as old servers do). */
  readonly sseOnly?: boolean;
}

export interface HttpFake {
  readonly base: string;
  readonly servers: McpServer[];
  readonly auth: FakeAuth;
  readonly lastAuthorization: () => string;
  readonly close: () => Promise<void>;
}

const readBody = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

const toRequest = async (req: IncomingMessage, base: string): Promise<Request> => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
  }
  const body = req.method === "POST" ? new Uint8Array(await readBody(req)) : undefined;
  return new Request(new URL(req.url ?? "/", base), {
    method: req.method ?? "GET",
    headers,
    ...(body !== undefined ? { body } : {}),
  });
};

const pipeResponse = async (response: Response, res: ServerResponse): Promise<void> => {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (response.body === null) return void res.end();
  const reader = response.body.getReader();
  res.on("close", () => void reader.cancel().catch(() => undefined));
  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
    if (done) break;
    res.write(value);
  }
  res.end();
};

export const startHttpFake = async (options: HttpFakeOptions = {}): Promise<HttpFake> => {
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();
  const sse = new Map<string, SseSession>();
  const servers: McpServer[] = [];
  let lastAuthorization = "";
  let base = "";
  const auth = makeFakeAuth(() => base, options.oauthRequireSecret);
  const fresh = (): McpServer => {
    const server = makeFakeServer({ whoami: () => lastAuthorization });
    servers.push(server);
    return server;
  };
  const authorized = (req: IncomingMessage, res: ServerResponse): boolean => {
    lastAuthorization = req.headers.authorization ?? "";
    if (options.oauth === true) return auth.guard(req, res);
    if (options.bearer === undefined || lastAuthorization === `Bearer ${options.bearer}`)
      return true;
    res.writeHead(401, { "content-type": "application/json" }).end('{"error":"unauthorized"}');
    return false;
  };
  const streamable = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const id = req.headers["mcp-session-id"];
    let transport = typeof id === "string" ? sessions.get(id) : undefined;
    if (transport === undefined) {
      if (typeof id === "string") return void res.writeHead(404).end();
      const created = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => void sessions.set(sessionId, created),
      });
      await fresh().connect(created);
      transport = created;
    }
    await pipeResponse(await transport.handleRequest(await toRequest(req, base)), res);
  };
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", base);
    if (await auth.route(req, res, url)) return;
    if (url.pathname === "/mcp" && !options.sseOnly) {
      if (authorized(req, res)) await streamable(req, res);
      return;
    }
    if (url.pathname === "/sse" && req.method === "GET") {
      if (!authorized(req, res)) return;
      const session = makeSseSession(res, (sessionId) => `/messages?sessionId=${sessionId}`);
      sse.set(session.sessionId, session);
      await fresh().connect(session);
      return;
    }
    if (url.pathname === "/messages" && req.method === "POST") {
      const session = sse.get(url.searchParams.get("sessionId") ?? "");
      if (session === undefined) return void res.writeHead(404).end();
      session.receive(JSON.parse((await readBody(req)).toString("utf8")));
      return void res.writeHead(202).end("Accepted");
    }
    res.writeHead(url.pathname === "/sse" ? 405 : 404).end();
  };
  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    servers,
    auth,
    lastAuthorization: () => lastAuthorization,
    close: async () => {
      for (const transport of sessions.values()) await transport.close().catch(() => undefined);
      for (const session of sse.values()) await session.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
