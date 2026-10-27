/**
 * The Connect button's two halves: start a sign-in (discovery, registration,
 * PKCE; returns the authorization URL to open) and finish it from the
 * callback (state checked single-use, code exchanged, tokens sealed).
 */
import { auth } from "@modelcontextprotocol/client";
import type { McpServerRecord } from "./config.ts";
import { makeOAuthProvider, type OAuthPending, type OAuthStore } from "./oauth.ts";

export interface OAuthWiring {
  readonly store: OAuthStore;
  readonly pending: OAuthPending;
  /** The redirect URL each server's flow uses (fixed per sign-in). */
  readonly redirectFor: (owner: string, id: string) => string;
  readonly onSecretForms: (owner: string, id: string, forms: readonly string[]) => void;
}

export const providerFor = (
  wiring: OAuthWiring,
  record: McpServerRecord,
  onRedirect: (url: string) => void = () => undefined,
) => {
  const scope = record.auth.kind === "oauth" ? record.auth.scope : undefined;
  const clientId = record.auth.kind === "oauth" ? record.auth.clientId : undefined;
  return makeOAuthProvider({
    store: wiring.store,
    pending: wiring.pending,
    owner: record.owner,
    id: record.id,
    redirectUrl: wiring.redirectFor(record.owner, record.id),
    ...(scope !== undefined ? { scope } : {}),
    ...(clientId !== undefined ? { clientId } : {}),
    onRedirect,
    onSecretForms: (forms) => wiring.onSecretForms(record.owner, record.id, forms),
  });
};

/** Start (or silently refresh) a sign-in: an URL to open, or null when already signed in. */
export const beginSignIn = async (
  wiring: OAuthWiring,
  record: McpServerRecord,
): Promise<string | null> => {
  if (record.url === null) throw new Error("only remote servers sign in");
  let url: string | null = null;
  const provider = providerFor(wiring, record, (next) => {
    url = next;
  });
  const scope = record.auth.kind === "oauth" ? record.auth.scope : undefined;
  const result = await auth(provider, {
    serverUrl: record.url,
    ...(scope !== undefined && scope !== "" ? { scope } : {}),
  });
  return result === "AUTHORIZED" ? null : url;
};

/** Exchange the callback's code (after the caller matched `state`). */
export const completeSignIn = async (
  wiring: OAuthWiring,
  record: McpServerRecord,
  code: string,
  iss: string | undefined,
): Promise<void> => {
  if (record.url === null) throw new Error("only remote servers sign in");
  const provider = providerFor(wiring, record);
  const result = await auth(provider, {
    serverUrl: record.url,
    authorizationCode: code,
    ...(iss !== undefined ? { iss } : {}),
  });
  if (result !== "AUTHORIZED") throw new Error("the sign-in did not complete");
};
