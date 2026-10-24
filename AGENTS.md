# AGENTS.md — ultiv

Effect-first, AI-native web app as a pnpm-workspace monorepo. `apps/server` (Node 24) runs a chord host with WebSocket links and a **pi-durable agent harness — all LLM chat goes through it**; `apps/web` (React 19 + TanStack Router + shadcn on Base UI + Tailwind 4) is the thin client over replicated chord state; `packages/contracts` holds the TypeBox chord contracts shared by both.

## Toolkit: Vite+ (`vp`) only

**Every command goes through `vp`. Never run `npm`, `npx`, `pnpm`, `yarn`, bare `node`, `tsc`, `vite`, `vitest`, `oxlint`, or `oxfmt` directly.** vp owns the whole chain:

| Need                        | Use                                                                            | Never                                   |
| --------------------------- | ------------------------------------------------------------------------------ | --------------------------------------- |
| Install / sync deps         | `vp install` (`--frozen-lockfile` in CI)                                       | `npm i`, `pnpm i`                       |
| Add / remove a dep          | `vp add <pkg> --filter <workspace>` (`-D` dev, `-E` exact), `vp remove`        | `npm install`, `pnpm add`               |
| Inspect deps                | `vp outdated`, `vp why`, `vp list`, `vp info`                                  | `npm ls`, `pnpm why`                    |
| Run a package script        | `vp run <task>` / `vpr <task>`; one workspace: `vp run --filter <name> <task>` | `npm run`, `pnpm --filter`              |
| Local binary                | `vp exec <bin>` (in a workspace: `vp -C <dir> exec <bin>`)                     | `npx`, `pnpm exec`                      |
| One-off package binary      | `vp dlx <pkg>`                                                                 | `npx <pkg>`                             |
| Node / a TS file            | `vp node <args>`; `vpx <file.ts>`                                              | `node`                                  |
| Format + lint               | `vp check` (`--fix`), `vp fmt`, `vp lint`                                      | `oxfmt`, `oxlint`, `eslint`, `prettier` |
| Tests                       | `vp test`                                                                      | `vitest`                                |
| Dev / build / preview       | `vp -C apps/web dev` / `build` / `preview`                                     | `vite`                                  |
| Anything else pnpm-specific | `vp pm <command>` (forwards to pnpm)                                           | bare `pnpm`                             |

- Vite+ 1.4.0 (global install + `vite-plus` devDep via the pnpm catalog). Must stay ≥ 1.1.0: 1.0.0 has known advisories (fixed 1.1.0/1.3.0); 1.4.0 is OSV-clean. Upgrade with `vp upgrade`; inspect with `vp toolchain`.
- Node 24 LTS, pinned in `mise.toml` (`node = "24"`); `vp node --version` resolves the same 24.x. A bare `node`/`npm` on PATH may come from homebrew — never trust it. If `vp` itself isn't on PATH, prepend `~/.vite-plus/bin`.
- pnpm 12 is the package manager underneath (`packageManager` field), but you only ever reach it through `vp`.
- Root `package.json` scripts (`check`, `build`, `test`, `smoke`) run with `vpr <name>`. `vp check` (built-in) and `vpr check` (script) do the same thing here.

## Commands (verified)

- `vp check` — format + lint gate (`--fix` to apply). It does NOT run our project typechecks.
- `vp exec tsc -p <pkg>/tsconfig.json` — the type gate, for each of `packages/contracts`, `apps/server`, `apps/web`. All three must pass.
- `vp test` — Vitest across workspaces (currently `packages/contracts`; one package: `vp run --filter @ultiv/contracts test`).
- `vp -C apps/web build` — production build of `apps/web` (root `vp build` needs the `-C` target; `vpr build` wraps this).
- `vp run smoke` — boots the whole server stack on an ephemeral port, offline (`apps/server/src/smoke.ts`).
- `vp install --frozen-lockfile` — verifies the lockfile is in sync and passes supply-chain policy.
- `vp -C apps/web exec shadcn <cmd>` — shadcn CLI (e.g. `add <component>`), run where `components.json` lives.

Not run automatically (long-running or live):

- `vp node --env-file=.env apps/server/src/ai/probe.ts` — LIVE provider check (network + keys): kenari through the harness, Jev typed decision.
- `vp run --filter @ultiv/server dev` — server with watch + `--env-file`; listens on `PORT` (default 8787).
- `vp -C apps/web dev` — web dev server.

**Gate for every change:** `vp check` → the three `vp exec tsc -p …` → `vp test` → `vp -C apps/web build` → `vp run smoke`. Re-run smoke after any dependency change; a clean typecheck alone does not prove runtime ESM wiring.

## Layout

- `packages/contracts` — chord contracts (TypeBox). All `remote()`/`local()` definitions live here; both apps import `@ultiv/contracts` (`workspace:*`).
- `apps/server/src/main.ts` — `buildStack()`: env-keyed providers → pi-ai `Models` → pi-durable `Harness.open` (MemoryStorage until SQLite lands) → chord `createHost` + `acceptWebSockets` (`ws`) + HTTP health. Dev runs unbundled (Node strips TS types).
- `apps/server/src/ai/` — `kenari.ts` (provider + agent defaults), `typesafe.ts` (Jev client), `probe.ts` (live verification).
- `apps/web` — React 19 + `@effect/atom-react`; `vite.config.ts` imports `defineConfig` from `"vite-plus"` (vp rewrites this on `vp migrate`) and loads `tanstackRouter` → `tailwindcss` → `react` plugins. See **Web UI** below.
- Root `vite.config.ts` — workspace-level vp config; only sets oxfmt `ignorePatterns` (the generated route tree).

## Web UI

- **Routing: TanStack Router, file-based.** Routes live in `apps/web/src/routes/` (`__root.tsx`, `index.tsx`, `chat.$conversationId.tsx`). The router plugin regenerates `src/routeTree.gen.ts` on `vp dev` / `vp build`. It is committed, never hand-edited, and excluded from oxfmt. `src/router.ts` creates the router and registers its type.
- **Components: shadcn, style `base-nova`, on Base UI (`@base-ui/react`), not Radix.** Config is `apps/web/components.json`; add components with `vp -C apps/web exec shadcn add <name>`. Primitives live in `src/components/ui/` (badge, button, card, input, scroll-area, separator, textarea). Icons: `lucide-react`.
- Base UI composes with the **`render` prop, not `asChild`**. When a `Button` renders a non-button element (e.g. a router `Link`), also pass `nativeButton={false}` — see `routes/index.tsx`.
- **Styling: Tailwind 4, CSS-first** — no `tailwind.config`; theme tokens and the `dark` variant live in `src/index.css` (imports `tailwindcss`, `tw-animate-css`, `shadcn/tailwind.css`, Geist variable font). Use the semantic tokens (`bg-background`, `text-muted-foreground`, …), not raw colors.
- `cn()` comes from the `cn` package (`src/lib/utils.ts` re-exports it), not clsx + tailwind-merge.
- Alias `@/*` → `apps/web/src/*`, declared in both `vite.config.ts` (`resolve.alias`) and `tsconfig.json` (`paths`) — keep them in sync.
- Current state: the chat route is a static scaffold on local `useState`; chord/pi-durable wiring to the server is not done yet.

## AI providers

- **Owner rule: every LLM chat/generation goes through pi-durable conversations** (`submit` → `wait` → `commit`), never raw `models.complete()` in app code. Conversations pin their model via `agent: kenariAgent()`.
- **kenari.id** — OpenAI-compatible gateway, wired as a pi-ai `createProvider` (`openAICompletionsApi`), auth `envApiKeyAuth` on `KENARI_API_KEY`. Model id comes from `KENARI_MODEL` (fallback constant `KENARI_FALLBACK_MODEL` is the only other site — grep both when switching). Spec source: models.dev `kenari/deepseek-v4-1-flash` (reasoning model, 1M ctx / 384k out). Before switching models: verify the id exists in `GET $KENARI_BASE_URL/models` and run the probe. Never use `response_format: json_object` — it hangs some kenari models; ask for strict JSON in the prompt. The model misreports its own id (`model_used` says gpt-4o/gpt-4.1) — ignore it; routing follows the requested id.
- **Typesafe.AI (Jev)** — `@typesafe-ai/sdk`, `client.systemOne({ state, questions })` with `noul`/`choice`/`score`/`box` builders; key `TYPESAFE_API_KEY`, model `jev-latest` (`TYPESAFE_MODEL` overrides). Jev is a typed decision side-channel, not a chat provider; if the harness needs it, expose it as a tool.
- `.env` holds provider keys — server-side only; never commit, print, or ship to the client. Load it with `vp node --env-file=…` (or the `dev`/`start` scripts), never by echoing it.

## Conventions

- ESM only; tabs (oxfmt via `vp fmt` enforces); `import type` for type-only imports (`verbatimModuleSyntax`).
- Relative imports use explicit `.ts` extensions (`allowImportingTsExtensions` + Node type stripping).
- `typebox` stays pinned EXACT `1.3.27` in every workspace that has it (`vp add -E typebox@1.3.27 --filter <ws>`) — chord requires exactly this version; anything else nests a duplicate copy. Bump only with chord.
- TypeBox is the only schema language at the chord boundary; Effect Schema stays inside effect services.
- Strict TS: `exactOptionalPropertyTypes` (never assign explicit `undefined` to optional props), `noUncheckedIndexedAccess`.

## Repo rules (set by the owner)

- **vp only** — no `npm`/`npx`/`pnpm`/bare `node` in commands, scripts, docs, or CI. If vp lacks a command, use `vp pm …` and note why.
- MAX 500 LoC per file; MAX 100 LoC per function/component — at 80 LoC, split.
- Code must be linted (`vp check`), typechecked (`vp exec tsc -p …` ×3), and tested (`vp test`) — the gate above is the proof. Never claim code is "tested" without it.
- Work done = work committed: atomic commits, conventional-commit messages (`feat:`, `fix:`, `chore:`, `build:`, `docs:`).

## Pitfalls

- **Never add `vite` or `vitest` as a dependency.** vp owns them via the pnpm catalog (`vite` → `@voidzero-dev/vite-plus-core`); a standalone vite makes `vp build` fail. Run `vp migrate --no-agent` if the alias drifts.
- `BACKGROUND_CONTEXT` is NOT exported from the chord root — import it from `@earendil-works/chord/context`.
- pi-durable's README examples drift from its 1.4.0 types — trust `dist/*.d.ts`: `AssistantEntry` stores the message in `record.model[0]` (`[AssistantMessage]`), `settled.answer` is an `EntryId`, `commit()` may return `undefined`.
- pnpm 12 gates build scripts with `allowBuilds` in `pnpm-workspace.yaml` (not the old `ignoredBuiltDependencies`). `@google/genai` and `protobufjs` are explicit `false` (vetted no-ops) — never flip to `true` without reading the script. To allow one deliberately: `vp add <pkg> --allow-build <pkg>`.
- `vp install` may report "Agent skills awaiting approval" (currently `@tanstack/react-router`, `@tanstack/router-plugin`). vp 1.4.0 does not forward pnpm's `approve` (`vp pm approve` errors; only `approve-builds` exists), so leave them unapproved — approving is the owner's call, not an agent's.
- Files Node executes directly (server, probe, smoke) must be erasable-syntax-only TS: no enums/namespaces/parameter properties.
- Annotate chord `principal` callbacks with the app `Principal` type — inline object literals widen string literals and break `Host<P>` inference.
- `tsconfig.json` files must stay strict JSON (tooling validates them; no comments).
