---
name: project-conventions
description: Project conventions for tangent-shell including file structure, imports, code quality, and general rules. Use when writing new code, creating files, or organizing imports.
---

# Project Conventions

## Project Overview

**tangent-shell** is an AI orchestration app: it drives agents and produces pipelines that the
broader Tangle platform (tangle, tangle-ui) consumes. It is a **pnpm + turbo monorepo**:

- `apps/web` (`@tangent/web`) — React + TypeScript frontend (Vite, Tailwind v4, React Compiler).
- `apps/server` (`@tangent/server`) — Express backend (Drizzle + SQLite, socket.io).
- `packages/shared` (`@tangent/shared`) — shared contracts/types (e.g. `@tangent/shared/contracts`).
- `packages/build` (`@tangent/build`) — shared build/lint config (incl. the custom ESLint rule).

## File Structure & Imports

- Use absolute imports with the `@/` prefix. In `apps/web` it resolves to `apps/web/src`.
- The frontend is **feature-sliced**, not organized by technical type:
  - `apps/web/src/features/<feature>/` — feature code, typically split into `api/`, `hooks/`,
    `model/` (query keys, display helpers), and `components/`.
  - `apps/web/src/routes/` — route components, layouts, and providers (code-based routing).
  - `apps/web/src/shared/` — cross-feature code: `ui/` (design system), `lib/`, `api/`, `config/`,
    `theme/`.
- **Import order**: external packages → internal `@/` modules → relative imports. `simple-import-sort`
  is configured in ESLint — let it sort.
- **No barrel exports** — import directly from the file that defines the symbol.

## Code Quality

- Follow the ESLint config (from `@tangent/build`) and format with Prettier.
- Prefer early returns to reduce nesting.
- Use descriptive variable and function names.
- **Don't pass a prop whose value equals its default** — omit it (e.g. `gap="0"` on a stack).
  Stating defaults is noise.
- See the `server-testing` skill for how tests work (server-side only, Node's `tsx --test`). There
  is no frontend test runner.

## Comments & Documentation

- **Keep comments minimal.** Comment only what isn't obvious from the code; explain _why_, never
  restate _what_. Often the right number of comments is zero. No verbose, wordy, or multiline
  comment blocks.
- **Never comment inside JSX / a component's `return`.** No `{/* ... */}` annotating elements, no
  comments labelling sections of markup. If markup needs explaining, fix the names instead.
- Keep comments up to date with code changes; delete stale ones.

## Error Handling

- The app is wrapped in an `ErrorBoundary` (`react-error-boundary`) with `RootErrorFallback`.
- Handle async errors with try/catch; surface failures through query/mutation error states.
- There is **no global toast/notify utility** — don't reference one. Render error state in the UI
  (e.g. an error message component) or let an error boundary catch it.

## UI

When writing JSX, layout, styling, or typography, **invoke the `ui-primitives` skill first** and
follow the layered design system. The hard rule: never pass `className` to a Tangle UI primitive —
it is enforced by `tangle-ui/no-classname-on-primitives` (error on `src/features/**` and
`src/routes/**`).

## Don't Do

- Don't use CSS-in-JS or styled-components.
- Don't use inline `style={}` except where strictly necessary.
- Don't pass `className` to a Tangle UI primitive (use a semantic prop or a Layer-3 pattern).
- Don't add new global state without good reason.
- Don't bypass existing abstractions without discussion.

## Planning & Documentation

When asked to create planning documents, architecture decisions, or investigation notes:

- **Always save to `.local/`** — gitignored for local-only files.
- Use descriptive filenames: `.local/feature-name-planning.md`, `.local/bug-investigation.md`.

## Optional "While We're Here" Cleanup

After completing a code generation task, scan the surrounding area for small, low-risk improvements.
**Only offer** if ALL conditions are met:

1. **Small scope**: Affects < 30 lines of code
2. **Low risk**: Purely cosmetic or minor refactoring (not logic changes)
3. **Same file**: In a file you already modified
4. **Clear benefit**: Improves readability, removes dead code, or fixes obvious issues

Don't be naggy — only offer once per task, and only if genuinely worthwhile.
