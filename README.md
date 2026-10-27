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
