# Express Best Practices

These practices govern the Express + TypeScript server under [`apps/server`](../apps/server). Like the [React best practices](./react-best-practices.md), they capture decisions that require judgment each time and can't always be enforced by automated rules. Use them as the default; deviate deliberately and ask for review when unsure.

The server runs on **Express 5** ([`express@^5.2.1`](../apps/server/package.json)) and has **zod** ([`zod@^4.4.3`](../apps/server/package.json)) available. Some sections below describe the _target_ pattern (notably zod request validation and strict-typed handlers) that the codebase is moving toward — they cite real files and call out where current code still differs.

## Guiding principles

- **Routers wire, handlers decide, stores/managers do the work.** A router file should read like a table of contents; the actual logic lives in small named functions and in the injected services.
- **Validate at the edge, trust inside.** Parse and narrow untrusted input (`body`, `params`, `query`) once, at the boundary. Everything downstream receives typed, validated values.
- **Group by feature, not by technical layer.** Keep a feature's routes, handlers, and helpers together so a change stays localized.
- **Small files, small functions.** If a file or function is hard to scan in one screen, split it.

## Feature scoping and file layout

Each feature gets its own router module under [`apps/server/src/routes`](../apps/server/src/routes) (e.g. `sessions.ts`, `agentBundles.ts`, `internalMemory.ts`). This is a "partial FSD" approach: slice by feature/domain, not by technical type. Avoid a global `controllers/`, `services/`, `validators/` split that scatters one feature across four folders.

Colocate feature-specific code with the feature; promote to shared only when it is genuinely reused (the same [colocation hierarchy](./react-best-practices.md#the-colocation-hierarchy) the React doc describes):

1. **Same file** — a helper used by one handler.
2. **Sibling `utils.ts` in the route folder** — shared by handlers within the feature.
3. **`@tangent/shared`** — request/response contracts and types shared between server and web (see `@tangent/shared/contracts.ts`).

When a feature grows beyond a single file, give it a folder instead of one large module:

```
routes/
  sessions/
    index.ts        // createSessionsRouter + route table
    handlers.ts     // handleCreateSession, handleGetSession, ...
    triggers.ts     // registerTriggerRoutes (sub-feature)
    utils.ts        // isUnsafeId, sanitizeFilename, isWithin
    schemas.ts      // zod schemas for this feature
```

```
# ❌ BAD: split by technical layer — one feature smeared across the tree
src/controllers/sessionsController.ts
src/services/sessionsService.ts
src/validators/sessionsValidator.ts
src/routes/sessions.ts

# ✅ GOOD: split by feature — everything sessions-related lives together
src/routes/sessions/{index,handlers,triggers,utils,schemas}.ts
```

## Routing

### Use the router-factory + dependency-injection pattern

Every router is created by a `createXRouter(deps): Router` factory and receives its dependencies as arguments. The composition root [`apps/server/src/index.ts`](../apps/server/src/index.ts) constructs the singletons once and wires them by hand — there is no DI container and no module-level singletons reached for inside handlers.

```ts
// ✅ GOOD: dependencies are explicit and injected (apps/server/src/index.ts)
app.use(
  "/api/sessions",
  createSessionsRouter(store, pi, triggers, triggerEngine, agentBundleStore),
);
app.use("/api/agent-bundles", createAgentBundlesRouter(agentBundleStore));
```

```ts
// ❌ BAD: handler reaches for a global singleton — untestable, hidden coupling
import { store } from "../singletons.ts";

router.get("/:id", (req, res) => {
  const session = store.getSession(req.params.id); // where did this come from?
});
```

### Keep route declarations thin

A route line should declare the method, path, and any route-scoped middleware, then delegate to a single named handler. No business logic inline.

```ts
// ✅ GOOD: thin route table (mirrors apps/server/src/routes/sessions.ts)
router.get("/:id", (req: Request<{ id: string }>, res: Response) =>
  handleGetSession(store, req, res),
);

router.patch("/:id", (req: Request<{ id: string }>, res: Response) =>
  handleUpdateSession(store, req, res),
);
```

```ts
// ❌ BAD: fat inline closure with logic in the route table
router.get("/:id", async (req, res) => {
  const session = await store.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  // ... 30 more lines ...
});
```

### Express 5 specifics

- **Async errors propagate automatically.** In Express 5 a rejected promise from an `async` handler is forwarded to the error-handling middleware — you no longer need to wrap handlers in a `try/catch` purely to call `next(err)`. Keep `try/catch` only when you want to map a specific failure to a specific status code.
- **Named wildcards.** Use `*splat` named params (e.g. `router.get("/:id/files/*splat", ...)` in `sessions.ts`), not the bare `*` from Express 4.
- **Path-to-regexp changes.** Optional/regex route syntax changed in v5; prefer simple, explicit paths.

## Handlers

### Extract top-level handler functions

Handlers are top-level functions with the shape `handleX(deps, req, res)`, defined outside the router body and referenced from the route table. This keeps the router scannable and makes handlers independently testable.

```ts
// ✅ GOOD: named, top-level handler (apps/server/src/routes/sessions.ts)
async function handleGetSession(
  store: SessionStore,
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> {
  const session = await store.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ session });
}
```

When a handler needs values that only exist at router-construction time, return a closure from a `createXHandler(deps)` factory (see `createArtifactFileHandler` / `createTriggerCallbackHandler` in `sessions.ts`) rather than capturing module-level state.

### Guard clauses, not nested ifs

Per the [required workflow](../.cursor/rules/required-workflow.mdc), flatten control flow with early returns. No nested ifs or loops.

```ts
// ❌ BAD: nested conditionals
async function handleRemember(store, memory, req, res) {
  const body = req.body;
  if (body.sessionId && body.text?.trim()) {
    const session = await store.getSession(body.sessionId);
    if (session) {
      // ... happy path buried two levels deep ...
    } else {
      res.status(404).json({ error: "Session not found" });
    }
  } else {
    res.status(400).json({ error: "sessionId and text are required" });
  }
}

// ✅ GOOD: guard clauses, happy path at the bottom (apps/server/src/routes/internalMemory.ts)
async function handleRemember(store, memory, onRemembered, req, res) {
  const body = (req.body ?? {}) as RememberBody;
  if (!body.sessionId || !body.text?.trim()) {
    res.status(400).json({ error: "sessionId and text are required" });
    return;
  }
  const session = await store.getSession(body.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  // happy path, fully narrowed
}
```

### Type the `Request` generic

Always type route params via the `Request<Params>` generic so `req.params` is checked at compile time.

```ts
// ✅ GOOD
(req: Request<{ id: string; triggerId: string }>, res: Response) => ...

// ❌ BAD: req.params.triggerId is `any`
(req: Request, res: Response) => ...
```

## Middleware

### Scope middleware as narrowly as possible

Apply middleware at the level it's actually needed: globally only for true cross-cutting concerns, per-router for router-wide concerns, and per-route for one-off parsing.

```ts
// Global: applies to every request (apps/server/src/index.ts)
app.use(express.json());

// Per-router: gate the whole internal API behind a token
// (apps/server/src/routes/internalMemory.ts)
router.use(requireInternalToken);

// Per-route: only this callback endpoint also accepts form-encoded bodies
// (apps/server/src/routes/sessions.ts)
router.post(
  "/:id/triggers/:triggerId/callback/:secret",
  urlencoded({ extended: true }),
  createTriggerCallbackHandler(triggerEngine),
);
```

### Reusable cross-cutting middleware

Factor recurring concerns (auth, token checks, request logging) into small middleware functions. The token guard is the model to follow — a factory parameterized by the connector credential, so the byte comparison lives in the credential and a route only says which far end it is for (`apps/server/src/middleware/requireCredential.ts`):

```ts
// ✅ GOOD: a focused, reusable guard parameterized by a credential
export function requireCredential(
  credential: ConnectorCredential,
): RequestHandler {
  return function guard(req: Request, res: Response, next: NextFunction): void {
    if (!credential.verify({ authorization: req.get("authorization") })) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}

// The internal API's guard is that factory bound to the Pi connector's credential
// (apps/server/src/middleware/requireInternalToken.ts):
export const requireInternalToken = requireCredential(piCredential);
```

### Centralize error handling

Register a single error-handling middleware (four args: `(err, req, res, next)`) after all routes so async failures land in one place with a consistent shape. Handlers should `throw` for unexpected failures and let this middleware format the response, rather than each handler hand-rolling a `500`.

```ts
// ✅ GOOD: one place owns the error response shape, mounted last in index.ts
function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const message = err instanceof Error ? err.message : "Internal error";
  res.status(500).json({ error: message });
}

app.use(errorHandler);
```

## Request validation with zod and strict-typed handlers

Today most handlers cast and hand-check input:

```ts
// ⚠️ CURRENT: manual cast + manual checks — the type is asserted, not verified
const body = (req.body ?? {}) as CreateSessionRequest;
if (!body.sessionId || !body.text?.trim()) {
  res.status(400).json({ error: "sessionId and text are required" });
  return;
}
```

The cast is a lie to the compiler: `as CreateSessionRequest` claims a shape that was never checked. Prefer parsing untrusted input with zod so the runtime value and the static type actually agree. zod is already used this way for bundle manifests in [`apps/server/src/pi/config/manifest.ts`](../apps/server/src/pi/config/manifest.ts).

### A reusable `validate()` middleware

Define a single middleware that parses `body`/`params`/`query`, responds `400` on failure, and stores the parsed (typed) values for the handler. Co-locate the schemas with the feature (e.g. `routes/sessions/schemas.ts`).

```ts
import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

interface Schemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

// Parsed values are attached under a single namespaced key to avoid colliding
// with Express's own (read-only in v5) req.query/req.params getters.
export function validate(schemas: Schemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = {
      body: schemas.body?.safeParse(req.body),
      params: schemas.params?.safeParse(req.params),
      query: schemas.query?.safeParse(req.query),
    };

    const failure = Object.values(result).find((r) => r && !r.success);
    if (failure && !failure.success) {
      res.status(400).json({
        error: "Invalid request",
        issues: failure.error.issues,
      });
      return;
    }

    (req as RequestWithValidated).validated = {
      body: result.body?.data,
      params: result.params?.data,
      query: result.query?.data,
    };
    next();
  };
}
```

### Derive handler types from the schema

Infer the handler's input type from the schema with `z.infer`, so there is exactly one source of truth and the handler is strict-typed without any casts.

```ts
// routes/sessions/schemas.ts
import { z } from "zod";

export const createSessionSchema = z.object({
  name: z.string().min(1).optional(),
  bundleId: z.string().optional(),
});
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
```

```ts
// ✅ GOOD: validated at the edge, strict-typed in the handler — no `as`
router.post("/", validate({ body: createSessionSchema }), (req, res) =>
  handleCreateSession(store, getValidated(req).body, res),
);

async function handleCreateSession(
  store: SessionStore,
  body: CreateSessionInput, // fully typed and runtime-verified
  res: Response,
): Promise<void> {
  const session = await store.createSession({ name: body.name });
  res.status(201).json({ session });
}
```

```ts
// ❌ BAD: the handler trusts an unchecked cast
async function handleCreateSession(store, req, res) {
  const body = (req.body ?? {}) as CreateSessionRequest; // never validated
  // body.bundleId could be a number, an object, anything
}
```

## Avoiding duplication

- **Share guard logic.** The "load session or 404" lookup repeats across nearly every handler in `sessions.ts`. Extract it into a helper (or middleware) that returns the session or sends the `404`, so handlers don't each re-implement it.
- **Share error maps.** Map domain outcomes to responses in one table instead of scattering literals. `sessions.ts` already does this with `CALLBACK_FAILURE`:

```ts
// ✅ GOOD: one mapping from outcome -> response (apps/server/src/routes/sessions.ts)
const CALLBACK_FAILURE: Record<
  "not-found" | "forbidden" | "disabled",
  { status: number; error: string }
> = {
  "not-found": { status: 404, error: "Trigger not found" },
  forbidden: { status: 403, error: "Forbidden" },
  disabled: { status: 409, error: "Trigger is disabled" },
};
```

- **One error shape.** Always respond with `{ error: string }` (optionally `{ error, issues }` for validation). Don't invent a new error envelope per route.

## Avoiding large files and functions

- **Keep the FTA score low.** Check a single file with `pnpm exec fta <file-path> --json`, or scan the server with `pnpm analyze:server`. A rising score is the signal to split.
- **Split a router when it grows.** When a route module accumulates many handlers (as `sessions.ts` has), promote it to a folder and move handlers/helpers/schemas into siblings (see [Feature scoping](#feature-scoping-and-file-layout)). `registerTriggerRoutes` in `sessions.ts` is a good example of extracting a sub-feature's routes into its own function.
- **One responsibility per function.** If a handler both validates, mutates several stores, and formats multiple response branches, break it apart (the `handleCreateSession` -> `resolveCreateBundle` -> `createSessionFromBundle` decomposition in `sessions.ts` is the model).
- **No nested ifs or loops** — flatten with early returns or extracted helpers.

## Splitting utils and helpers

Put helpers at the lowest level that satisfies their callers, and name them for what they do — not for a generic bucket.

- **Route-local `utils.ts`** for feature-specific helpers like `isUnsafeId`, `sanitizeFilename`, and `isWithin` in `sessions.ts` (path-safety logic that only the sessions feature needs).
- **`@tangent/shared`** only for things genuinely shared between server and web — chiefly the request/response contracts in `@tangent/shared/contracts.ts`.

Red flags (the same ones the React doc warns about):

- A `utils/` or `helpers/` module full of domain-specific logic that only one feature imports.
- Deep `../../../` import chains reaching across features.
- A generically named `helpers.ts` that has become a junk drawer of unrelated functions.

```ts
// ❌ BAD: domain logic hiding in a generic shared bucket
// shared/utils.ts
export function sanitizeSessionUploadFilename(name: string) { ... }

// ✅ GOOD: keep it next to the only feature that uses it
// routes/sessions/utils.ts
export function sanitizeFilename(name: string) { ... }
```

## Other clean suggestions

- **Correct status codes.** `201` for creates, `202` for accepted-but-async (the trigger callback), `204` for deletes with no body, `400`/`401`/`403`/`404`/`409` for the matching client errors. `sessions.ts` is a good reference for the full set.
- **No business logic in routers.** Routers orchestrate; the real work belongs in the injected stores/managers (`SessionStore`, `PiAgentManager`, `TriggerEngine`, `MemoryManager`). A handler should read as: validate -> call a service -> format the response.
- **Sanitize untrusted path input.** Anything that becomes a filesystem path must be checked for traversal before use — see `isUnsafeId` / `isWithin` guarding the artifact and upload routes in `sessions.ts`.
- **Lean on Express 5 async error handling.** Let rejected promises bubble to the central error middleware; reserve `try/catch` for mapping a known failure to a specific status (as `createSessionFromBundle` does to return `400` on a bad bundle).
- **Don't use `useCallback`/`useMemo` mindset here — but do keep handlers pure.** A handler's only side effects should be through the injected services and the `res` object; don't mutate module-level state.
- **Validate before mutating.** Resolve and validate everything that can fail _before_ you create or change state, so a bad request never leaves a half-provisioned resource behind (the create-session flow resolves the bundle before creating the session for exactly this reason).

## Validation (run at the end)

Per the [required workflow](../.cursor/rules/required-workflow.mdc), after changes:

```bash
pnpm lint
pnpm typecheck
pnpm format
```

Fix lint issues with `pnpm lint --fix` first, then re-run.

## References

- [React Best Practices](./react-best-practices.md) — colocation hierarchy and doc style this mirrors.
- [Server Architecture Review](./server/index.md) — the DI wiring and request lifecycle.
- [Required Workflow](../.cursor/rules/required-workflow.mdc) — code quality, FTA, and validation rules.
- [Express 5 migration guide](https://expressjs.com/en/guide/migrating-5.html) — async errors, `*splat` params, path-to-regexp changes.
- [zod documentation](https://zod.dev) — schema definition and `z.infer`.
