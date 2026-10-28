/**
 * Test-only OAuth 2.1 authorization server for an MCP resource at /mcp:
 * protected-resource metadata (RFC 9728), AS metadata (RFC 8414), dynamic
 * client registration (RFC 7591), authorization code + PKCE S256, refresh.
 * `/authorize` approves at once (the "user" always says yes).
 */
import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface FakeAuth {
  readonly route: (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>;
  readonly guard: (req: IncomingMessage, res: ServerResponse) => boolean;
  /** Every access token issued (to prove none leaks). */
  readonly issued: string[];
  /** The `resource` parameter seen at /authorize and /token. */
  readonly resources: string[];
  readonly expireAll: () => void;
  readonly counts: { registrations: number; refreshes: number };
  /** Client secrets the token endpoint REQUIRES (confidential-client mode). */
  readonly requireSecret?: string;
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
};

const readText = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

const readForm = async (req: IncomingMessage): Promise<URLSearchParams> =>
  new URLSearchParams(await readText(req));

const token = (prefix: string): string => `${prefix}_${randomBytes(18).toString("hex")}`;

export const makeFakeAuth = (baseOf: () => string, requireSecret?: string): FakeAuth => {
  const codes = new Map<string, { challenge: string; redirect: string }>();
  const live = new Set<string>();
  const refresh = new Set<string>();
  const issued: string[] = [];
  const resources: string[] = [];
  const counts = { registrations: 0, refreshes: 0 };
  /** Confidential clients must present the secret (Basic header or form). */
  const secretOk = (_req: IncomingMessage, form: URLSearchParams): boolean => {
    if (requireSecret === undefined) return true;
    if (form.get("client_secret") === requireSecret) return true;
    const header = _req.headers.authorization ?? "";
    if (!header.startsWith("Basic ")) return false;
    const decoded = Buffer.from(header.slice(6), "base64url").toString("utf8");
    return decoded.split(":")[1] === requireSecret;
  };
  const grant = (res: ServerResponse): void => {
    const access = token("at");
    const next = token("rt");
    live.add(access);
    refresh.add(next);
    issued.push(access);
    json(res, 200, {
      access_token: access,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: next,
    });
  };
  const tokenRoute = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const form = await readForm(req);
    resources.push(form.get("resource") ?? "");
    if (requireSecret !== undefined && !secretOk(req, form)) {
      return json(res, 401, { error: "invalid_client" });
    }
    if (form.get("grant_type") === "refresh_token") {
      if (!refresh.delete(form.get("refresh_token") ?? ""))
        return json(res, 400, { error: "invalid_grant" });
      counts.refreshes += 1;
      return grant(res);
    }
    const entry = codes.get(form.get("code") ?? "");
    const verifier = form.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (
      entry === undefined ||
      entry.challenge !== challenge ||
      entry.redirect !== form.get("redirect_uri")
    ) {
      return json(res, 400, { error: "invalid_grant" });
    }
    codes.delete(form.get("code") ?? "");
    grant(res);
  };
  const metadata = () => ({
    issuer: baseOf(),
    authorization_endpoint: `${baseOf()}/authorize`,
    token_endpoint: `${baseOf()}/token`,
    registration_endpoint: `${baseOf()}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported:
      requireSecret === undefined ? ["none"] : ["none", "client_secret_basic"],
  });
  return {
    issued,
    resources,
    counts,
    expireAll: () => live.clear(),
    guard: (req, res) => {
      const header = req.headers.authorization ?? "";
      if (header.startsWith("Bearer ") && live.has(header.slice(7))) return true;
      res
        .writeHead(401, {
          "www-authenticate": `Bearer resource_metadata="${baseOf()}/.well-known/oauth-protected-resource/mcp"`,
        })
        .end();
      return false;
    },
    route: async (req, res, url) => {
      const path = url.pathname;
      if (path.startsWith("/.well-known/oauth-protected-resource")) {
        json(res, 200, { resource: `${baseOf()}/mcp`, authorization_servers: [baseOf()] });
      } else if (path.startsWith("/.well-known/oauth-authorization-server")) {
        json(res, 200, metadata());
      } else if (path === "/register" && req.method === "POST") {
        counts.registrations += 1;
        const body = JSON.parse((await readText(req)) || "{}") as object;
        json(res, 201, { ...body, client_id: `client_${counts.registrations}` });
      } else if (path === "/authorize") {
        const code = token("code");
        const redirect = url.searchParams.get("redirect_uri") ?? "";
        resources.push(url.searchParams.get("resource") ?? "");
        codes.set(code, { challenge: url.searchParams.get("code_challenge") ?? "", redirect });
        const target = new URL(redirect);
        target.searchParams.set("code", code);
        target.searchParams.set("state", url.searchParams.get("state") ?? "");
        res.writeHead(302, { location: target.toString() }).end();
      } else if (path === "/token" && req.method === "POST") {
        await tokenRoute(req, res);
      } else {
        return false;
      }
      return true;
    },
  };
};
