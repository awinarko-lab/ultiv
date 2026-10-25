/**
 * Identity: the principal seam. Chord stamps every link (and every REST
 * request, via the header) with a principal; the registry, conversations and
 * tasks scope themselves under its owner label. There is no IdP yet —
 * `x-ultiv-user` IS the identity — but every key and registry row is
 * owner-partitioned HERE, in one file, so a real authenticator later only
 * replaces `principalFromHeaders` and the WebSocket callback.
 */
export type Principal = { kind: "guest" } | { kind: "user"; id: string } | { kind: "server" };

export const USER_HEADER = "x-ultiv-user";

/** The registry label a principal's data lives under. */
export const ownerOf = (principal: Principal): string =>
  principal.kind === "user" ? principal.id : "guest";

/** The durable conversation key for an app session id, scoped to its owner. */
export const sessionKey = (owner: string, id: string): string => `${owner}:${id}`;

/** Resolve a principal from header-style access; empty/missing means guest. */
export const principalFromHeaders = (get: (name: string) => string | undefined): Principal => {
  const id = (get(USER_HEADER) ?? "").trim();
  return id === "" ? { kind: "guest" } : { kind: "user", id };
};

/** The principal of an incoming HTTP request (REST and WebSocket upgrades alike). */
export const principalFromRequest = (request: { readonly headers: unknown }): Principal => {
  const headers = request.headers as { get?: (name: string) => unknown } | Record<string, unknown>;
  const raw =
    typeof (headers as { get?: unknown }).get === "function"
      ? (headers as { get: (name: string) => unknown }).get(USER_HEADER)
      : (headers as Record<string, unknown>)[USER_HEADER];
  const id = typeof raw === "string" ? raw.trim() : "";
  return id === "" ? { kind: "guest" } : { kind: "user", id };
};
