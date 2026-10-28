# Ultiv

**A local-first home for AI bots.** One runtime, one entity per bot: each bot has its own persona, memory, durable files, vault scope, tools, schedules and audit trail — chatting with you, with each other, and acting on your machine under your approval. The default profile is **Ultius**; you create as many others as you want.

Ultiv is an Effect-first web app as a pnpm-workspace monorepo: a Node API server, a React client, and a mind that hosts the entities. Everything runs on your hardware; provider keys stay server-side in `.env`, and bot credentials live in a sealed local vault the model can never read.

## Highlights

- **Entities, not chatbots** — per-profile persona, memory (v2), artifacts, tool allowlist, cron schedules, and audit. Bots discover each other, message each other over a mailbox with deadlines, and cooperate in contextual rooms.
- **Two shells** — `bash` runs scripts in a hardware-isolated [microsandbox](https://microsandbox.dev) microVM (real Linux: python, network, `apt-get`) whose files sync into the durable artifact store; `bash_host` is a privileged shell on the host computer, always approval-gated.
- **Credentials that can't leak** — a vault sealed with AES-256-GCM; bots see names and masked hints only. The credential broker spends a secret inside its binding (hosts, methods, path prefixes) via `http_request`; responses are scrubbed and audited without the secret.
- **Routines** — cron schedules, self-set webhooks (schema-validated, write-ahead receipts, retries then dead-letter), and sensors (RSS, calendar ICS, watch URLs) wake bots on a timezone-aware schedule. Busy turns are steered, not queued blindly.
- **Tasks** — background sub-agent turns in their own durable conversations that wake their parent with the outcome on settle; restarts resume them.
- **Human in the loop** — side-effecting tools park on approval cards ("Always allow" is per tool and never covers the dangerous ones). Push notifications tell you when a bot needs you.
- **MCP connectors** — streamable HTTP / SSE / stdio servers added live from the UI or by a bot (behind an approval card), with OAuth and vault-referenced headers. Presets included.
- **PWA + Web Push** — install to a Home Screen; push on task completion, waiting approvals, and routine replies. The service worker caches only the offline shell.

## Requirements

- **Node 24 LTS** (pinned in `mise.toml`) and **pnpm 12** — both reached through [Vite+](https://vite-plus.dev) (`vp`), the only toolchain this repo uses.
- **macOS with Apple Silicon or Linux with KVM** for the `bash` microVM (microsandbox/libkrun). Everything else runs anywhere Node 24 runs; without virtualization the bash tool reports a clear error and the rest of the platform works.

## Install & run

```sh
git clone https://github.com/orgrigami/ultiv.git && cd ultiv
vp install                      # installs deps through pnpm (owned by vp)
cp .env.example .env            # fill in the keys you actually use; every key is optional
vp run dev                      # API on :8787, web on :5173
```

Open http://localhost:5173, create a bot, chat. `vp` itself: install once with `npm i -g @voidzero-dev/vite-plus` (or see `AGENTS.md` if it isn't on PATH).

### Environment

Copy `.env.example` and set what you use — features without their key report themselves as off:

| Key | Purpose |
| --- | --- |
| `KENARI_API_KEY` | LLM gateway (chat/generation) — required for conversations |
| `KENARI_MODEL` | optional model override (default `deepseek-v4-1-flash`) |
| `TYPESAFE_API_KEY` | Typesafe.AI decision model (Jev) for yes/no, pick, rate, ask |
| `VAULT_KEY` | **turns the vault on** — long random secret, e.g. `printf 'VAULT_KEY=%s\n' "$(openssl rand -hex 32)" >> .env` |
| `MCP_OAUTH_CALLBACK_URL` | OAuth callback for connectors (default `http://localhost:8787/api/mcp/oauth/callback`) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push; generate with `vpr @ultiv/server#push:keys` |

Back `VAULT_KEY` up outside this machine: losing or changing it makes every saved vault item unreadable, and there is no key rotation yet.

## The two shells

| Tool | Where it runs | Has | Gating |
| --- | --- | --- | --- |
| `bash` | a microsandbox microVM per workspace scope | full Linux: coreutils, pipes, python3, pip, network, `apt-get` | approval per call (auto-approvable) |
| `bash_host` | **the host computer, directly** | the whole real filesystem, permanently | approval per call, **never auto-approve** |

Both carry the working directory across calls. Files a `bash` script writes under `/home` become **artifacts**: visible in `artifact_list`, served by the web UI, persisted across restarts (deletions sync too). The durable artifact store is the source of truth; each call pushes it into the VM and reconciles changes back, so a crashed VM loses nothing that was synced.

`bash_host` is for tasks that genuinely need the host machine. It is deliberately excluded from always-allow policies — approval is the safety mechanism.

## Architecture

```
apps/server   Node 24 host: REST + chord replication + triggers (cron/webhooks/sensors), thin over the mind
apps/web      React 19 + TanStack Router + shadcn (Base UI) + Tailwind 4 client
packages/core       kernel: tagged errors + the promise↔Effect door
packages/ext        extension platform: tools, plugins, registry, vault, credential broker, shells
packages/mind       the entity substrate: converse, decide, act, generate, tasks, profiles, routines, memory
packages/contracts  TypeBox chord contracts shared by server and web
```

One runtime, one entity per profile. Sessions replicate over chord; registries (sessions, artifacts, webhooks, cron, audit) are plain REST. `AGENTS.md` is the full developer map: package-by-package layout, the `vp` command rules, conventions, and the repo's pitfalls.

## Development

Everything goes through `vp` — never raw `npm`/`pnpm`/`node`/`tsc`/`vitest`:

```sh
vp install                      # deps
vp check --fix                  # format + lint
vp exec tsc -p packages/ext/tsconfig.json   # typecheck (all six workspaces must pass)
vp test                         # unit tests
vp -C apps/web build            # production web build
vp run smoke                    # boots the whole stack offline on an ephemeral port, exercises REST
```

The gate for every change: `vp check` → six typechecks → `vp test` → web build → `vp run smoke`. A live provider probe (needs real keys): `vp node --env-file=.env packages/mind/src/probe.ts`.

## Security model

- **Owner-scoped everything.** REST and replication resolve a principal (`x-ultiv-user`); unauthenticated traffic is `guest`. A real IdP replaces one module (`apps/server/src/identity.ts`).
- **Secrets never reach a model.** Bots name vault items or file `secret_request`; values enter through an owner-checked REST endpoint and are stored sealed — they never appear in transcripts, audit logs, or notifications.
- **Gates act, not ask.** Read-only tools run freely; side-effecting tools wait for approval. Destructive classes (artifact deletes, connector changes, first-time credential use per host, `bash_host`) can never be blanket-allowed.
- **Egress is bounded.** `http_request` is https-only with an SSRF/DNS guard, host/method/path-prefix bindings, redirect and size caps, and scrubbed responses.
- **`.env` never leaves the machine** — server-side only, never printed or shipped to the client.

## Documentation

- `AGENTS.md` — the developer contract: layout, vp rules, gate, conventions, pitfalls.
- `docs/ROUTINES.md` — the durability + delivery contract for cron/webhooks/sensors.
- `docs/MEMORY.md` — the memory-faculty contract (tiers, recall, guard, tidy).
