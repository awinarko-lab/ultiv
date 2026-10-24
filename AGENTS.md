# AGENTS.md — ultiv

Effect-first, AI-native web app (browser + mobile). Runtime core is `effect` 4; the AI layer is `@earendil-works/pi-durable` (durable agent harness) on `@earendil-works/pi-ai` (unified LLM API) and `@earendil-works/chord` (distributed objects whose contracts are TypeBox schemas). Pure ESM (`"type": "module"`), TypeScript 7. No UI framework or bundler chosen yet.

## Dev environment

- Node is mise-pinned: `mise.toml` → `node = "24"` (LTS line; 24.22.1 + npm 11.19.1 installed).
- **Run every project command through mise**: `mise exec -- <cmd>`. Bare `node`/`npm` on PATH resolve to `~/.vite-plus` copies, not the mise toolchain — never trust a plain `node --version`.
- TypeScript 7.0.2 (native-compiler 7 line), invoked as `npx tsc` under mise.

## Commands (verified)

- `mise exec -- npm run typecheck` — `tsc --noEmit` over `src/`. Gate for every change.
- `mise exec -- npm run smoke` — executes `src/smoke.ts` directly (Node 24 strips TS types natively). Re-run after any dependency change; a clean typecheck alone does not prove runtime ESM wiring.
- `mise exec -- npm install <pkg>`; use `mise exec -- npm install --save-exact <pkg>@<ver>` for exact pins.
- No lint runner or test framework is configured yet. Until one exists, typecheck + smoke are the only gates — never claim code is "tested" without them.

## Architecture notes

- `typebox` is pinned EXACT `1.3.27` because chord depends on exactly that version; any other spec nests a duplicate copy → `Type` identity and type mismatches. Bump only together with chord.
- Chord contracts are runtime TypeBox values (`remote("name", { version, input, host: hostNamed(...), variants: { default: { state, methods } } })`). Model new contracts on `src/smoke.ts` and the chord README.
- Chord and pi-durable run in Node AND browsers. Subpaths ending in `/node` (e.g. `@earendil-works/chord/node`, `@earendil-works/pi-durable/storage/jsonl/node`) are Node-only; `@earendil-works/pi-durable/storage/indexeddb` is the browser/mobile persistence path.
- effect 4: `import { Effect } from "effect"`. Its exports map has no `types` condition — TS falls back to sibling `dist/*.d.ts`. That is intentional packaging; don't try to "fix" it.

## Conventions (observed)

- ESM named imports; `import type` for type-only imports — `verbatimModuleSyntax` makes this mandatory.
- Tabs for indentation; header comment on standalone scripts (see `src/smoke.ts`).
- Strict TS plus `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`: never assign explicit `undefined` to optional props; indexed access returns `T | undefined`.

## Repo rules (set by the owner)

- MAX 500 LoC per file; MAX 100 LoC per function/component — at 80 LoC, split.
- Code must be linted, typechecked, and tested; typecheck is `npm run typecheck`.
- Work done = work committed: commit atomically as chunks complete, with conventional-commit messages (`feat:`, `fix:`, `chore:`, `refactor:`, …).
- `.env` holds provider API keys (pi-ai reads e.g. `OPENAI_API_KEY`) and is gitignored — never commit, print, or echo it.

## Pitfalls

- npm 11 parks package install scripts behind approval (`npm warn install-scripts`). Currently parked: `@google/genai` preinstall (a no-op echo) and `protobufjs` postinstall (non-essential) — safe to ignore. Review with `npm install-scripts ls`; approve only load-bearing scripts.
- Files Node executes directly (smoke tests, scripts) must be erasable-syntax-only TS: `import type`, no enums/namespaces — Node strips types, it doesn't compile them.
- `tsconfig.json` is `noEmit` by design — emit belongs to the bundler chosen later.
- `tsconfig.json` must stay strict JSON (no comments/trailing commas) — tooling validates it as plain JSON.
