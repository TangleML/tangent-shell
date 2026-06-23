# CLAUDE.md

Always-on context for this repo. Read every session. Skills carry the detail — this file
tells you which to load and the rules that must never be skipped.

## Read the right skill BEFORE you code

Skills are not auto-loaded — you must invoke them. Do it *before* writing code, not after:

- Writing JSX / styling / layout / typography → **`ui-primitives`** (non-negotiable, see below)
- Creating files, organizing imports, general structure → **`project-conventions`**
- TypeScript / types → **`typescript-standards`**
- Components, hooks, providers, React Compiler → **`react-patterns`**
- Pipelines, runs, components, tasks, inputs/outputs (any domain term) → **`tangle-domain`**
- Data fetching / mutations / cache → **`tanstack-query`**
- Routes / navigation / search params → **`tanstack-router`**
- Tests → **`server-testing`** (server-side only, Node's `tsx --test`; no frontend test runner)
- User-facing copy / errors / banners → **`open-source`**
- Interactive UI, forms, dialogs → **`accessibility`**
- Analytics events / `action_type` naming → **`analytics-tracking`** (aspirational — not yet built)

When a task spans several, load each relevant one first.

## Code navigation

If the `codanna` MCP server is connected, prefer its tools for understanding and navigating
code — `find_symbol`, `semantic_search_with_context`, `analyze_impact`, `find_callers`,
`get_calls` — over Grep/Glob. Fall back to Grep only for literal string matches (error
messages, config keys, CSS classes, URLs). Codanna results are pointers; confirm with Read
before editing. Setup is per-user and optional — skip this if the server isn't connected.

Scoping searches:
- Narrow with `kind` (`Function`, `Interface`, `TypeAlias`, `Class`, `Method`, `Constant`) — the
  most effective lever.
- The `module` filter and `lang: "typescript"` do **not** separate frontend from backend: module
  paths aren't indexed (always blank), and both apps are TypeScript. Tell which app you mean by
  reading the result's file-path prefix — `apps/web/src/…` is frontend, `apps/server/src/…` is
  backend — and phrase queries with that context.

## Non-negotiable rules

### Comments — keep them minimal
No verbose or multiline inline comment blocks. Comment only what isn't obvious from the code;
explain *why*, never restate *what*. Often the right number of comments is zero. The user
actively dislikes comment noise.

### UI — never pass `className` to a Tangle UI primitive
Use a semantic prop or a Layer-3 pattern instead. Enforced by `tangle-ui/no-classname-on-primitives`
(error on `apps/web/src/features/**` and `apps/web/src/routes/**`). The `className` escape hatch
is deprecated — do not use it in new code.

- Live in the upper layers. Reaching down is a smell.
- Layout: `BlockStack`/`InlineStack`, never `<div className="flex ...">`.
- Text: `Heading`/`Paragraph`/`Text`, never raw `<h*>/<p>/<span>` + Tailwind.
- Named intent (panel, row, scroll region, ...) → Layer-3 pattern (`Surface`, `Section`, `Card`,
  `ListRow`, `ScrollRegion`, `EmptyState`, `IconButton`, `Toolbar`, ...).
- `cn()` / raw Tailwind allowed **only** in local primitives (raw HTML, marked `// local primitive`).
- No CSS-in-JS / styled-components. No inline `style={}` unless strictly necessary.

Full reference: [apps/web/src/shared/ui/DESIGN_SYSTEM.md](apps/web/src/shared/ui/DESIGN_SYSTEM.md).
Invoke the `ui-primitives` skill for the component catalog.

### Other standing rules
- Absolute imports with `@/` prefix; no barrel exports; import order external → internal → relative.
- Prefer early returns over nesting.
- Planning / investigation notes go in `.local/` (gitignored), not committed docs.
- Don't modify `componentSpec` structure without explicit permission.
- Don't add new global state without good reason.

## Repo layout (pnpm + turbo monorepo)

- `apps/web` — React + TS frontend (Vite, Tailwind v4). Code lives under `src/features/*`,
  `src/routes/*`, shared UI in `src/shared/ui` (base primitives + `patterns/`).
- `apps/server` — backend.
- `packages/shared`, `packages/build` — shared workspace packages.

## Commands (run from repo root)

- `pnpm dev` — run everything (turbo)
- `pnpm validate` — typecheck + lint + build. **Does not run tests.** (run before considering work done)
- `pnpm typecheck` / `pnpm lint` / `pnpm build` — individually
- `pnpm format` — Prettier

Package manager is **pnpm** (`pnpm@10.28.0`). Use `pnpm --filter <pkg>` for a single workspace.

### Tests
Tests exist in **`apps/server` only**, run via Node's built-in test runner (not Vitest):
- All: `pnpm --filter @tangent/server test` (runs `src/**/*.test.ts`)
- One file: `pnpm --filter @tangent/server exec tsx --test src/path/to/x.test.ts`

`apps/web` has no test setup. **Vitest and Playwright are not configured in this repo** — don't
assume those runners exist. See the `server-testing` skill for patterns. `pnpm validate` skips tests,
so run the server tests explicitly when you touch server code.

### Database (apps/server)
Persistence is **Drizzle + SQLite**. If you change the schema, generate a migration —
`pnpm --filter @tangent/server db:generate` — and apply with `db:migrate`. Don't hand-edit the DB.
