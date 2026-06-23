---
name: validate
description: Run validation and testing commands for the project. Use when the user asks to validate, lint, typecheck, or run tests.
disable-model-invocation: true
allowed-tools: Bash(pnpm *)
argument-hint: [test]
---

# Validate & Test

Run project validation and testing commands from the repo root.

## Available Commands

- **`pnpm validate`** — runs `turbo run typecheck lint build` across the monorepo. Use before
  considering work done. **It does not run tests.**
- **`pnpm typecheck`** / **`pnpm lint`** / **`pnpm build`** — run a single step individually.
- **`pnpm format`** — Prettier (`prettier --write .`).
- **`pnpm --filter @tangent/server test`** — server tests (Node's built-in runner via
  `tsx --test`, over `apps/server/src/**/*.test.ts`). This is the **only** test suite in the repo.
  One file: `pnpm --filter @tangent/server exec tsx --test src/path/to/x.test.ts`.

There is **no** `validate:test`, `test:e2e`, `test:coverage`, or `knip` script, and `apps/web` has
no test runner configured.

## Usage

- `/validate` — run `pnpm validate`
- `/validate test` — run `pnpm validate` then `pnpm --filter @tangent/server test`

## Local Development

- `pnpm dev` — runs everything via turbo.
- **Frontend** (`apps/web`): Vite dev server (Vite's default port).
- **Backend** (`apps/server`): the Vite dev server proxies `/api` and `/socket.io` to the backend at
  `http://localhost:8787` by default (override with the `API_TARGET` env var).
