---
name: typescript-standards
description: TypeScript coding standards for this project. Use when writing TypeScript code, defining types, or working with type safety.
---

# TypeScript Standards

## Core Rules

- Use strict TypeScript with proper typing.
- Prefer explicit types over `any` (only use `any` when absolutely necessary).
- Use `interface` or `type` for object shapes, `type` for unions/primitives — match the surrounding
  file.

## Avoid Unsafe Type Casting

Don't use type assertions (`as`) unless absolutely necessary. Instead prefer:

- Type guards and runtime validation
- Proper typing from the source
- Union types and type narrowing
- **Zod** (`zod` v4 is available) for validating external/untrusted data

```typescript
// Bad
const something: string = myjson as string;

// Good — validate, or narrow with a guard
function isString(value: unknown): value is string {
  return typeof value === "string";
}
```

## API & Data Types

- **Cross-boundary types are shared**, not generated. Import request/response and entity types from
  `@tangent/shared` (e.g. `import type { AgentBundleMeta } from "@tangent/shared/contracts"`) so the
  web client and the server agree on one source of truth.
- Frontend API calls live in per-feature `api/` modules (e.g.
  `features/agent-bundles/api/agentBundlesApi.ts`) that `fetch` and parse into those shared types.
- Feature-local types live alongside the feature (in the feature folder or its `model/`), not in a
  global `src/types` directory.
- There is **no** generated API client (`src/api/types.gen.ts`) and **no** `componentSpec.ts` in this
  repo — those belong to tangle-ui (see `tangle-domain`).

## Naming Conventions

- Components / classes / types / interfaces: **PascalCase**.
- Variables / functions: **camelCase**.
- Constants: **SCREAMING_SNAKE_CASE**.
- Files: match the surrounding directory. Feature and route components use **PascalCase**
  (`AgentBundlesPage.tsx`); shared UI primitives use **kebab-case** (`list-row.tsx`,
  `icon-button.tsx`); utility/hook modules use **camelCase** (`agentBundlesApi.ts`,
  `useAgentBundles.ts`). When unsure, match what's already there.
