---
name: server-testing
description: How tests work in this repo — server-side only, using Node's built-in test runner via tsx. Use when writing, running, or reviewing tests.
---

# Server Testing

Tests in this repo exist in **`apps/server` only**, and run on **Node's built-in test runner**
(`node:test`) executed through `tsx`. There is **no Vitest, no Playwright, and no frontend test
setup** — `apps/web` has no test runner configured. If frontend testing is added later, document it
here (or in a new skill) and wire it into `pnpm validate`.

## Running tests

```bash
# all server tests (apps/server/src/**/*.test.ts)
pnpm --filter @tangent/server test

# a single file
pnpm --filter @tangent/server exec tsx --test src/path/to/x.test.ts
```

`pnpm validate` (`turbo run typecheck lint build`) does **not** run tests — run them explicitly when
you touch server code.

## Test file conventions

- Co-locate tests next to the source: `src/store/seedBundles.ts` → `src/store/seedBundles.test.ts`.
- Import from `node:test` and `node:assert/strict`. Use `test()` blocks (this codebase uses `test`,
  not `describe`/`it`).
- Relative imports use explicit **`.ts` extensions** (matching the rest of the server source under
  the NodeNext/tsx setup).

```typescript
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { installBundle, loadInstalledConfig } from "./bundleLoader.ts";

test("loads an installed bundle config", () => {
  const config = loadInstalledConfig(/* ... */);
  assert.equal(config.name, "research-assistant");
});
```

## Assertions

Use `node:assert/strict`:

```typescript
assert.equal(actual, expected);
assert.deepEqual(obj, { id: "abc" });
assert.ok(value);
assert.throws(() => parse(bad));
await assert.rejects(promise);
```

## Mocking and spies

Use the runner's built-in `mock` from `node:test` (no `vi`/jest):

```typescript
import { mock, afterEach } from "node:test";

const fn = mock.fn();
const spy = mock.method(obj, "method");

afterEach(() => {
  mock.reset();
});
```

## Fixtures over deep mocking

Existing tests favor **real, deterministic fixtures** over elaborate mock graphs — e.g. building a
temp directory with `mkdtempSync`/`tmpdir`, zipping a real example bundle with `fflate`, and
asserting on the result. Prefer driving the unit under test with realistic inputs and a fake at the
process/IO boundary (see `pi/piAgentManager.test.ts`, which drives a `FakeChild` `EventEmitter`
instead of spawning a real process) rather than mocking every collaborator.

## Database tests

Persistence is Drizzle + SQLite. When testing store code, use a throwaway/in-memory database and
apply migrations rather than mutating a real DB file.
