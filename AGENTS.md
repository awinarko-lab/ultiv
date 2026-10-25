# AGENTS.md — ultiv

Effect-first, AI-native web app as a pnpm-workspace monorepo. The **core is three packages**: `@ultiv/core` (kernel: shared tagged errors + the `openRuntime` promise↔Effect door), `@ultiv/ext` (the extension platform: tools, connectors, plugins, registry), and `@ultiv/mind` (the platform's ONE AI entity, named **Ultius** — durable `converse`, independent Jev `decide`, `act` tool surface; the package keeps its working name `mind`). `apps/server` (Node 24) is a thin chord host over the mind; `apps/web` (React 19 + TanStack Router + shadcn on Base UI + Tailwind 4) is the thin client over replicated chord state; `packages/contracts` holds the TypeBox chord contracts shared by both.

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
- `vp exec tsc -p <pkg>/tsconfig.json` — the type gate, for each of `packages/contracts`, `packages/core`, `packages/ext`, `packages/mind`, `apps/server`, `apps/web`. All six must pass.
- `vp test` — Vitest across workspaces (`packages/contracts`, `packages/core`, `packages/ext`, `packages/mind`; one package: `vp run --filter @ultiv/core test`).
- `vp -C apps/web build` — production build of `apps/web` (root `vp build` needs the `-C` target; `vpr build` wraps this).
- `vp run smoke` — boots the whole server stack on an ephemeral port, offline (`apps/server/src/smoke.ts`; delegates to the server workspace script because `vp node` cannot resolve node inside a nested `vp run`).
- `vp install --frozen-lockfile` — verifies the lockfile is in sync and passes supply-chain policy.
- `vp -C apps/web exec shadcn <cmd>` — shadcn CLI (e.g. `add <component>`), run where `components.json` lives.

Not run automatically (long-running or live):

- `vp node --env-file=.env packages/mind/src/probe.ts` — LIVE provider check (network + keys): kenari converse through the harness, Jev via the `jev_score` tool, Jev `decide` direct.
- `vp run --filter @ultiv/server dev` — server with watch + `--env-file`; listens on `PORT` (default 8787).
- `vp -C apps/web dev` — web dev server.

**Gate for every change:** `vp check` → the six `vp exec tsc -p …` → `vp test` → `vp -C apps/web build` → `vp run smoke`. Re-run smoke after any dependency change; a clean typecheck alone does not prove runtime ESM wiring.

## Layout

- `packages/core` (`@ultiv/core`) — the kernel, no domain knowledge: `errors.ts` (shared tagged-error taxonomy: `NotFound`, `InvalidInput`, `Duplicate`, `Unavailable`, `AuthMissing`, `External`) and `runtime.ts` (`openRuntime(layer, key)` — builds a fully-provided Layer into a live service under a caller-owned scope; the door promise-land code enters through). Deps: `effect` only.
- `packages/ext` (`@ultiv/ext`) — the extension platform. `tool.ts` (pi-durable-shaped `Tool` + `gated` flag; pi-durable is a TYPE-ONLY dep here), `connector.ts` (auth specs + TypeBox-typed actions + `invoke`: validate → authenticate → perform), `plugin.ts` (`definePlugin` + capability union `tool | connector | section` — new kinds extend the union), `registry.ts` (the `Registry` service: tools/sections/connector resolution; duplicate identities fail at build time), `plugins/http.ts` (reference HTTP egress connector). Lifecycle is Effect layering, not plugin callbacks.
- `packages/mind` (`@ultiv/mind`) — the AI entity, named **Ultius** (the package keeps the working name `mind`). Faculties: `converse` (pi-durable harness: `root`/`ensure`/`submit`/`settle`/`turn`/`configure`/`agentOf` + `docs` for app-level session-scope documents + `projectTranscript`/`usageOf` — the projection and spend accounting every surface renders through), `decide` (Jev: `yesNo`/`pick`/`rate`/`ask`, independent of any conversation), `act` (tools assembled from the Registry; `gated` tools wrapped by the approval broker — gates ACTS, never ASKS; sections come from plugins — the identity section rides `identityPlugin`). `entity.ts` composes the five services into `Mind`; `openMind(options)` is the promise-land entry (`{ mind, close }`). Enter Effect-natively via `mindLayer(options)`. Owner rule enforced here: `turn` (submit → wait → commit) is the only path an input reaches a model.
- `packages/contracts` — chord contracts (TypeBox). All `remote()`/`local()` definitions live here; both apps import `@ultiv/contracts` (`workspace:*`). Session is v4 (usage/model/effort state + `configure`), Sessions is v2 (model catalog + `remove`; removal is registry-level — durable conversations stay in storage).
- `apps/server/src/main.ts` — `buildStack()`: `openMind({ plugins: [httpPlugin] })` → chord `createHost` + `acceptWebSockets` (`ws`) + HTTP health; `close()` tears down links then the mind's scope (harness finalizers). Dev runs unbundled (Node strips TS types).
- `apps/server/src/session.ts` / `sessions.ts` — the app-facing chord objects (Session replay/approvals, session list); they consume `MindService` only — no direct provider/harness access.
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

- **Owner rule: the mind is the only provider consumer.** Every LLM chat/generation goes through pi-durable conversations inside `@ultiv/mind` (`converse.turn` = `submit` → `wait` → `commit`), never raw `models.complete()` in app code. Conversations start on the kenari default (`KENARI_MODEL`, fallback `KENARI_FALLBACK_MODEL` in `packages/mind/src/config.ts` — grep both when switching); sessions override via `converse.configure(conversation, { model, effort })` (durable `conversation.configure`; read back with `agentOf`). The catalog in `providers/kenari.ts` — DeepSeek 4.1 Flash (default), GLM 5.3 Flash, Kimi K3.1 Pro, all through kenari for now — is verified against `GET /v1/models` (2026-10-25) with specs from models.dev (kimi-k3-1-pro absent there: gateway metadata, IDR→USD ÷ 16,500). Efforts are PER MODEL, from the gateway's `supported_reasoning_levels`: deepseek off/low/high/max (toggleable), glm-5-3-flash and kimi-k3-1-pro low/high/max (no off — they always reason); `off` maps to the gateway's `none`. Usage surfaced to contracts/UI is TOKENS only — cost stays internal to pi-ai (`COST_RATES` in providers/kenari.ts). Compaction compacts at **75%** of each model's context window (`kenariCompaction()` in Harness `settings.compaction`, per-model overrides). Jev decisions have an independent entry: `mind.decide.*` — the same faculty also appears as `jev`/`jev_score`/`jev_pick`/`jev_rate` agent tools via the decision plugin (descriptions are first-person faculty: "your own decision faculty, Jev" — the entity is ONE, never narrated as an external helper).
- **kenari.id** — OpenAI-compatible gateway, wired as a pi-ai `createProvider` (`openAICompletionsApi`), auth `envApiKeyAuth` on `KENARI_API_KEY`. Model id comes from `KENARI_MODEL` (fallback constant `KENARI_FALLBACK_MODEL` lives in `packages/mind/src/config.ts` — the only other site; grep both when switching). Spec source: models.dev `kenari/deepseek-v4-1-flash` (reasoning model, 1M ctx / 384k out). Before switching models: verify the id exists in `GET $KENARI_BASE_URL/models` and run the probe. Never use `response_format: json_object` — it hangs some kenari models; ask for strict JSON in the prompt. The model misreports its own id (`model_used` says gpt-4o/gpt-4.1) — ignore it; routing follows the requested id.
- **Typesafe.AI (Jev)** — `@typesafe-ai/sdk`, `client.systemOne({ state, questions })` with `noul`/`choice`/`score`/`box` builders; key `TYPESAFE_API_KEY`, model `jev-latest` (`TYPESAFE_MODEL` overrides). Jev is a typed decision model, not a chat provider: `decide/decide.ts` wraps it behind the narrow `JevGateway` seam (`decide/gateway.ts`) so tests substitute fakes. Unconfigured keys fail LOUDLY but lazily: `decideService(undefined)` fails every call with `Unavailable`; the decision plugin simply isn't installed.
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
- Code must be linted (`vp check`), typechecked (`vp exec tsc -p …` ×6), and tested (`vp test`) — the gate above is the proof. Never claim code is "tested" without it.
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
- Effect 4 (the repo's version) drifts from Effect 3 habits: there is NO `Effect.catchAll` (use `Effect.match` / `catchTag` / `catchIf`); `ConfigError` imports from `"effect/Config"`, not the root; `Layer.merge` is binary (chain `.pipe(Layer.merge(…))` or `mergeAll`); `Layer.buildWithScope` yields a `Context` — extract the service with its key; `Config`'s env provider snapshots `process.env` at FIRST use, so tests must set env at module load, never mid-test; `Data.TaggedError` instances yield directly (`return yield* new NotFound(…)`).
- Effect Layers compose services; a parameterized layer is a function returning a Layer. Long-lived runtimes (server, probe) go through `openRuntime(layer, key)` in `@ultiv/core` — never `Effect.scoped` around a service that must outlive the call.
- Structured tool outputs must be JsonValue-compatible: use `type` aliases, not `interface`, for result shapes (interfaces lack implicit index signatures).
- `vp node` cannot resolve node when invoked INSIDE a `vp run` script — root scripts delegate (`vpr smoke` → the server workspace script) instead of nesting `vp node`.
