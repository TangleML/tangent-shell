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
- Tests → **`vitest-testing`** (unit/component) or **`e2e-testing`** (Playwright)
- User-facing copy / errors / banners → **`open-source`**
- Interactive UI, forms, dialogs → **`accessibility`**
- Analytics events / `action_type` naming → **`analytics-tracking`**

When a task spans several, load each relevant one first.

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
- `pnpm validate` — typecheck + lint + build (run before considering work done)
- `pnpm typecheck` / `pnpm lint` / `pnpm build` — individually
- `pnpm format` — Prettier

Package manager is **pnpm** (`pnpm@10.28.0`). Use `pnpm --filter <pkg>` for a single workspace.
