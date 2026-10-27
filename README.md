# Ultiv

A pnpm + vite-plus monorepo: `apps/server` (API on 8787), `apps/web` (Vite dev
server on 5173), and the `packages/*` libraries. See `AGENTS.md` for the full
layout, the `vp` command rules, and the change gate.

## Run it

```sh
cp .env.example .env   # then fill in the keys you use
vp install
vp run dev             # API on :8787, web on :5173
```

## Vault

The vault stores logins, cards, keys, notes and contacts, sealed with
AES-256-GCM. It is off until `VAULT_KEY` is set.

- `VAULT_KEY` (required to turn it on): any long random secret. Generate one
  without printing it: `printf 'VAULT_KEY=%s\n' "$(openssl rand -hex 32)" >> .env`,
  then restart the server.
- `VAULT_DIR` (optional): where items live, relative to the server's folder.
  Default `var/vault`, so `apps/server/var/vault/<owner>/items/` in dev.

Back the key up somewhere outside this machine. Losing or changing it makes
every saved item unreadable, and there is no key rotation yet. Exported bot
bundles only reopen under the same key. Item names and masked hints are stored
unencrypted next to each item.

Today bots see item names and masked hints (`vault_list`) and can look up
contacts (`vault_contacts`). No tool uses stored logins, cards or keys yet.

## Connectors (MCP)

Bots can use tools from MCP servers over streamable HTTP, SSE (legacy) or a
local stdio command; `auto` tries HTTP and falls back to SSE. Add them on the
Connectors screen, or ask a bot to (`connector_add`). They connect live, with
no restart.

- Config lives under `MCP_DIR` (default `var/mcp`, one `servers.json` per
  owner, 0600). It holds no secret bytes: header values and stdio env vars
  point at vault items.
- OAuth servers sign in through `MCP_OAUTH_CALLBACK_URL` (default
  `http://localhost:8787/api/mcp/oauth/callback`). Set it to the tailnet https
  URL to sign in from a phone.
- Presets: context7 (optional key), deepwiki (none), linear and notion
  (OAuth).
- A connector's first call raises a card; after that its read-only tools run
  on their own. A bot sees each server's tools through `connector_load`.

**Bot-managed connectors.** `connector_list` and `connector_reconnect` run
freely. `connector_add`, `_update`, `_disable`, `_enable` and `_remove` park on
an approval card that shows the exact change: URL or command, transport,
auth, which bots get it, and a warning when a stdio command would run on
this Mac. These cards are never auto-approved and "Always allow" does not
cover them. The card adds a caution when the request may have come from
untrusted content (connector output, a bot message, a room or a task).

**Secure input.** A bot never takes a key as a tool argument. It names an
existing vault item, or calls `secret_request`, which shows a masked field in
the chat. The value goes straight to `POST /api/secrets/:callId` (owner
checked) and into the vault. It never reaches the model, the transcript, the
audit log, server logs or notifications. The field expires after 10 minutes.

## Bot discovery

Each bot's prompt lists its siblings in one short line each (name, id, an
80-character role; at most 20). For more, bots call `bots_list` (roles, whether
they may message each bot, tool groups; archived bots on request) and
`bot_info` (one bot by name or id: role, the persona's first line, contact
rights both ways, tool groups, busy/idle). Both are read-only, follow the
profile's tool allowlist, and never show another bot's memory, files, vault
or chats.
