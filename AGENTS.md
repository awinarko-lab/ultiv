# AGENTS.md — ultiv

Effect-first, AI-native web app as a pnpm monorepo. `apps/server` (Node 24) runs a chord host with WebSocket links and a **pi-durable agent harness — all LLM chat goes through it**; `apps/web` (React 19) is the thin client over replicated chord state; `packages/contracts` holds the TypeBox chord contracts shared by both. Toolchain is Vite+ (`vp`), which owns vite/vitest/oxlint/oxfmt.

## Dev environment

- Node 24 LTS via mise (`mise.toml` → `node = "24"`). Run commands under `vp exec …` or `mise exec -- …`; a bare `node`/`npm` on PATH comes from `~/.vite-plus`/homebrew — never trust it.
- Vite+ 1.4.0 (global + `vite-plus` devDep). Must stay ≥ 1.1.0: 1.0.0 has known advisories (fixed 1.1.0/1.3.0); 1.4.0 is OSV-clean.
- Package manager: pnpm 12 (`packageManager` field), driven via `vp install`. Never run bare `pnpm` for installs.

## Commands (verified)

- `vp check` — format + lint gate (`--fix` to apply). It does NOT run our project typechecks.
- `vp exec tsc -p <pkg>/tsconfig.json` — the type gate, for each of `packages/contracts`, `apps/server`, `apps/web`. All three must pass.
- `vp test` — Vitest across workspaces (currently `packages/contracts`).
- `npm run build` — production build of `apps/web` (`vp -C apps/web build`; root `vp build` needs a `-C` target).
- `npm run smoke` — boots the whole server stack on an ephemeral port, offline (`apps/server/src/smoke.ts`).
- `vp exec node --env-file=.env apps/server/src/ai/probe.ts` — LIVE provider check (network + keys): kenari through the harness, Jev typed decision.
- `pnpm --filter @ultiv/server dev` — server with watch + `--env-file`; listens on `PORT` (default 8787).

## Layout

- `packages/contracts` — chord contracts (TypeBox). All `remote()`/`local()` definitions live here; both apps import `@ultiv/contracts` (`workspace:*`).
- `apps/server/src/main.ts` — `buildStack()`: env-keyed providers → pi-ai `Models` → pi-durable `Harness.open` (MemoryStorage until SQLite lands) → chord `createHost` + `acceptWebSockets` (`ws`) + HTTP health. Dev runs unbundled (Node strips TS types).
- `apps/server/src/ai/` — `kenari.ts` (provider + agent defaults), `typesafe.ts` (Jev client), `probe.ts` (live verification).
- `apps/web` — React 19 + `@effect/atom-react`; `vite.config.ts` imports `defineConfig` from `"vite-plus"` (vp rewrites this on `vp migrate`).

## AI providers

- **Owner rule: every LLM chat/generation goes through pi-durable conversations** (`submit` → `wait` → `commit`), never raw `models.complete()` in app code. Conversations pin their model via `agent: kenariAgent()`.
- **kenari.id** — OpenAI-compatible gateway, wired as a pi-ai `createProvider` (`openAICompletionsApi`), auth `envApiKeyAuth` on `KENARI_API_KEY`. Model id comes from `KENARI_MODEL` (fallback constant `KENARI_FALLBACK_MODEL` is the only other site — grep both when switching). Spec source: models.dev `kenari/deepseek-v4-1-flash` (reasoning model, 1M ctx / 384k out). Before switching models: verify the id exists in `GET $KENARI_BASE_URL/models` and run the probe. Never use `response_format: json_object` — it hangs some kenari models; ask for strict JSON in the prompt. The model misreports its own id (`model_used` says gpt-4o/gpt-4.1) — ignore it; routing follows the requested id.
- **Typesafe.AI (Jev)** — `@typesafe-ai/sdk`, `client.systemOne({ state, questions })` with `noul`/`choice`/`score`/`box` builders; key `TYPESAFE_API_KEY`, model `jev-latest` (`TYPESAFE_MODEL` overrides). Jev is a typed decision side-channel, not a chat provider; if the harness needs it, expose it as a tool.
- `.env` holds provider keys — server-side only; never commit, print, or ship to the client.

## Conventions

- ESM only; tabs (oxfmt enforces); `import type` for type-only imports (`verbatimModuleSyntax`).
- Relative imports use explicit `.ts` extensions (`allowImportingTsExtensions` + Node type stripping).
- `typebox` stays pinned EXACT `1.3.27` in every workspace that has it — chord requires exactly this version; anything else nests a duplicate copy. Bump only with chord.
- TypeBox is the only schema language at the chord boundary; Effect Schema stays inside effect services.
- Strict TS: `exactOptionalPropertyTypes` (never assign explicit `undefined` to optional props), `noUncheckedIndexedAccess`.

## Repo rules (set by the owner)

- MAX 500 LoC per file; MAX 100 LoC per function/component — at 80 LoC, split.
- Code must be linted, typechecked, and tested — the gates above are the proof.
- Work done = work committed: atomic commits, conventional-commit messages (`feat:`, `fix:`, `chore:`, `build:`, `docs:`).

## Pitfalls

- **Never add `vite` or `vitest` as a dependency.** vp owns them via the pnpm catalog (`vite` → `@voidzero-dev/vite-plus-core`); a standalone vite makes `vp build` fail. Run `vp migrate` (with `--no-agent`) if the alias drifts.
- `BACKGROUND_CONTEXT` is NOT exported from the chord root — import it from `@earendil-works/chord/context`.
- pi-durable's README examples drift from its 1.4.0 types — trust `dist/*.d.ts`: `AssistantEntry` stores the message in `record.model[0]` (`[AssistantMessage]`), `settled.answer` is an `EntryId`, `commit()` may return `undefined`.
- pnpm 12 gates build scripts with `allowBuilds` in `pnpm-workspace.yaml` (not the old `ignoredBuiltDependencies`). `@google/genai` and `protobufjs` are explicit `false` (vetted no-ops) — never flip to `true` without reading the script.
- Files Node executes directly (server, probe, smoke) must be erasable-syntax-only TS: no enums/namespaces/parameter properties.
- Annotate chord `principal` callbacks with the app `Principal` type — inline object literals widen string literals and break `Host<P>` inference.
- `tsconfig.json` files must stay strict JSON (tooling validates them; no comments).
