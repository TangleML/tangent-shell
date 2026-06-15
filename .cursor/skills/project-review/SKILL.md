---
name: project-review
description: Review code changes for quality, architecture, and adherence to project standards. Use when reviewing pull requests, commits, or when the user asks for a code review, project review, or architecture review.
---

# Project Review

Perform a holistic code review of recent changes against project standards. **Always switch to Plan mode** before delivering findings — reviews are read-only suggestions, not direct edits.

## Workflow

1. **Gather scope** — Determine what to review:
   - If a PR or commit is specified, use `git diff` / `git show` to get changed files.
   - If reviewing "the last commit", use `git show HEAD --stat`, then read those files.
   - If no scope is given, ask the user.

2. **Read full files** — Always read the complete files being reviewed, not just diffs. Context matters.

3. **Read project standards** — Before analyzing, read these files to ground the review in project rules:
   - `docs/react-best-practices.md` — React-specific patterns (stable values, co-location, Suspense, UI primitives).
   - The relevant `.claude/skills/*` skills — `project-conventions`, `react-patterns`, `typescript-standards`, and `ui-primitives`.
     Use them as the primary source of truth. The checklist below summarizes and extends these rules, but defer to the source files when in doubt.

4. **Switch to Plan mode** — Call `SwitchMode` with `target_mode_id: "plan"` before presenting findings. All suggestions must be delivered as a plan, not as direct edits.

5. **Analyze** — Check each area below against the changed code.

6. **Report** — Use the output format at the bottom of this file.

---

## Review Checklist

### 1. React Compiler Adoption

New components and files **must** be created behind React Compiler.

- When React Compiler covers a file, unnecessary `useCallback` / `useMemo` should be removed (the compiler handles memoization).
- Verify no compiler-violating patterns: mutating during render, reading refs during render, conditional hooks.

### 2. Co-location

Code should live as close as possible to where it's used. Follow the hierarchy:

1. Same file
2. Sibling file in the same folder
3. Parent folder
4. Feature/domain folder
5. Shared/common folder (only if truly cross-feature)

**Red flags:**

- "shared" or "common" folders with code imported from a single place.
- Deep `../` import paths.
- Utils/helpers containing domain-specific logic.
- Components in shared folders with feature-specific props.

### 3. Code Duplication & Helper Extraction

- Look for repeated logic across changed files and their neighbors.
- Suggest extracting shared helpers, keeping them co-located per the hierarchy above.
- Prefer pure functions; ensure helpers are tested when non-trivial.

### 4. Readability via Component Extraction

- Flag render methods or JSX blocks longer than ~50 lines.
- Suggest extracting well-named sub-components when a block has a clear single responsibility.
- Extracted components should be co-located (same file or sibling file).
- Code should be optimized for reading and extending, not for writing speed.

### 5. Component Size

- Flag components exceeding **~200 lines** as candidates for splitting.
- Look for **mode switches** (`if`/ternary on a discriminator that changes the entire render) as natural split points — each mode should be its own component.
- Dual pagination, dual data sources, or dual state management within one component is a strong signal that it handles multiple responsibilities.
- Extracted sub-components should be co-located per the hierarchy in section 2.
- **Orchestrator + nested components rule:** When a folder has one main "orchestrator" component and all other components exist solely to serve it, the nested components go inside a `components/` subfolder. The orchestrator stays at the folder root so the public API is immediately visible.

```
MyFeature/
  MyFeature.tsx              <-- orchestrator (public API)
  components/
    SubComponentA.tsx        <-- nested, internal to MyFeature
    SubComponentB.tsx
```

### 6. useMutation Best Practices

- **Always destructure** the `useMutation` return value. Never access `.mutate()` or `.mutateAsync()` through the full mutation object in JSX.

```tsx
// ❌ BAD
const removePipeline = useRemovePipeline();
// later: removePipeline.mutate(id)

// ✅ GOOD
const { mutate: removePipeline, isPending: isRemoving } = useRemovePipeline();
// later: removePipeline(id)
// plus: disabled={isRemoving} on the trigger
```

- **Show loading state**: Use `isPending` to disable triggers and show spinners during mutations.
- **Complex async handlers** (try/catch, multi-step, branching) must be refactored into `useMutation`:
  - Move the async logic into `mutationFn`.
  - Use `onSuccess` / `onError` callbacks for side effects (toasts, cache invalidation, state resets).
  - Use **discriminated unions + `switch`** instead of `if/else` chains for type-based dispatch inside `mutationFn`.
  - Use `Promise.all` for parallel operations instead of sequential `for` loops when order doesn't matter.

```tsx
// ❌ BAD — raw async handler with try/catch and if/else
const handleDrop = async (targetFolderId: string, rawData: string) => {
  try {
    const items = JSON.parse(rawData);
    for (const item of items) {
      if (item.type === "pipeline") {
        await movePipeline(item.id, targetFolderId);
      } else if (item.type === "folder") {
        await moveFolder(item.id, targetFolderId);
      }
    }
    notify("Moved", "success");
  } catch (error) {
    notify("Failed", "error");
  }
};

// ✅ GOOD — useMutation with discriminated union dispatch
function moveDragItem(item: DragItem, targetFolderId: string) {
  switch (item.type) {
    case "pipeline":
      return assignPipelineToFolder(item.id, targetFolderId);
    case "folder":
      return moveFolder(item.id, targetFolderId);
  }
}

const { mutate: handleDrop } = useMutation({
  mutationFn: async ({ targetFolderId, rawData }) => {
    const items = JSON.parse(rawData) as DragItem[];
    return Promise.all(items.map((item) => moveDragItem(item, targetFolderId)));
  },
  onSuccess: () => {
    notify("Moved", "success");
  },
  onError: (error) => {
    notify("Failed: " + getErrorMessage(error), "error");
  },
});
```

### 7. UI Primitives Over Plain Markup

Prefer project UI primitives over raw HTML:

| Instead of                            | Use                                          |
| ------------------------------------- | -------------------------------------------- |
| `<div className="flex flex-col ...">` | `<BlockStack>`                               |
| `<div className="flex ...">`          | `<InlineStack>`                              |
| `<span>`, `<p>`, `<h1>`–`<h6>`        | `<Text>` with `as`, `size`, `weight`, `tone` |
| `<button className="...">`            | `<Button>` with `variant`, `size`            |
| Raw icon imports                      | `<Icon>` component                           |

- If a needed primitive doesn't exist, suggest a reasonable addition or improvement to the UI primitive library.
- Flag mixed paradigms (primitives alongside utility-heavy raw divs in the same component).

### 8. SOLID Principles

- **S** — Single Responsibility: each component/function/hook does one thing.
- **O** — Open/Closed: prefer composition and variants over modifying existing components.
- **L** — Liskov Substitution: component variants should be interchangeable.
- **I** — Interface Segregation: avoid god-props; split large interfaces.
- **D** — Dependency Inversion: depend on abstractions (hooks, context) not concrete implementations.

### 9. Function Signatures — Options Objects

- Functions with **3 or more parameters** must use an options object.
- Functions with 2 parameters are acceptable, but consider an options object if the parameters are of the same type or their purpose isn't obvious at the call site.

```tsx
// ❌ BAD
function createTrigger(name: string, prompt: string, cron: string, enabled: boolean) { ... }

// ✅ GOOD
interface CreateTriggerOptions {
  name: string;
  prompt: string;
  cron: string;
  enabled: boolean;
}
function createTrigger(options: CreateTriggerOptions) { ... }
```

### 10. TypeScript Typings

- **Prefer named interfaces** over inline type literals. Extract even small shapes into interfaces — they're reusable, self-documenting, and easier to extend.
- **`as any`** is a **red flag** (High severity). It silences the compiler entirely and must be removed. Suggest proper typing or `unknown` with narrowing.
- **`as Type`** casts are a **yellow flag** (Medium severity). Prefer type guard functions or runtime validation instead of assertions.
- **Non-null assertions (`!`)** are a **yellow flag** (Medium severity). Even when a preceding guard makes the value safe at runtime (`while (arr.length > 0) { const x = arr.pop()!; }`), the `!` bypasses the type system. Replace with an explicit null check:
  ```typescript
  const x = arr.pop();
  if (!x) return;
  ```
- **Enforce strict types** — no implicit `any`, no untyped function parameters, no `// @ts-ignore` / `// @ts-expect-error` without justification.
- Prefer `interface` for object shapes and `type` for unions/primitives.
- Props interfaces should be named `ComponentNameProps` and exported when the component is exported.

```tsx
// ❌ BAD — inline type, casting
function getUser(data: unknown) {
  return data as { name: string; id: number };
}

// ❌ RED FLAG
const value = something as any;

// ✅ GOOD — named interface, type guard
interface User {
  name: string;
  id: number;
}

function isUser(data: unknown): data is User {
  return (
    typeof data === "object" && data !== null && "name" in data && "id" in data
  );
}
```

### 11. Event Handlers

- **Inline handlers are OK** when they are a single expression or depend on a closure variable (e.g. inside `.map()`).
- **Multi-line handlers** (2+ statements) should be extracted into a named function. Name them `handle<Event>` or `handle<Subject><Event>` (e.g. `handleClick`, `handleInputClick`).
- Extracted handlers improve readability, stack traces, and testability.

```tsx
// ✅ OK — single expression
<Button onClick={() => setOpen(true)} />;

// ✅ OK — closure dependency from map
{
  items.map((item) => (
    <Button key={item.id} onClick={() => onSelect(item.id)} />
  ));
}

// ❌ BAD — multi-line inline handler
<Component
  onClick={(e) => {
    e.stopPropagation();
    onInputClick(input.name, e);
  }}
/>;

// ✅ GOOD — extracted and named
const handleInputClick = (event: React.MouseEvent) => {
  event.stopPropagation();
  onInputClick(input.name, event);
};

<Component onClick={handleInputClick} />;
```

### 12. State Management & Encapsulation

State should live in the right layer and be accessed through a clear public API. This project keeps server state in TanStack Query, local UI state in hooks, and app-wide state in React context.

- **Server state belongs in TanStack Query**: Fetching/caching/mutation logic lives in co-located query/mutation hooks (e.g., `useSessions`, `useAgentBundle`), not ad-hoc `useEffect` + `fetch` in components.
- **Encapsulate behind hooks**: Components consume feature hooks rather than reaching into query keys, raw fetch clients, or context internals directly.
- **Single source of truth**: Don't duplicate server-derived data into local `useState`; read it from the query cache. Don't duplicate the same state-change logic across modules — share a hook.

**Red flags:**

- Components calling `fetch`/the API client directly instead of going through a feature hook.
- Copying query data into local state, then keeping the two in sync manually.
- Multiple modules duplicating the same mutation/cache-invalidation logic instead of sharing a hook.

### 13. General Quality (from docs/react-best-practices.md)

- **Imports**: absolute `@/` paths, correct order (external → internal → relative).
- **State**: Tanstack Query for server state, hooks for local state, Context for app-wide state.
- **Error handling**: proper try/catch, toast for user-facing errors, error boundaries.
- **React patterns**: functional components only, proper hook dependency arrays, no components inside components, functional state updates when depending on previous state.
- **Async data**: `useSuspenseQuery` + `withSuspenseWrapper` for async components, matching skeleton components.
- **Stable values**: context providers return stable values, custom hooks return stable values, keys in lists are stable.
- **Comments**: explain "why" not "what". Remove obvious/narrating comments.
- **No `console.log` / `console.debug` in production code** — remove debug logging before merging. Use a proper logger if runtime diagnostics are needed.
- **No `setTimeout(..., 0)` to work around rendering timing** — this is a code smell that means state is initialized incorrectly. Initialize state in the correct phase (constructor, action, or effect) instead of deferring with a zero-delay timeout.
- **No direct DOM mutations** (`element.style.x = ...`) inside React components without a documenting comment explaining why the React render cycle cannot handle the update (e.g., optimistic visual feedback during a drag interaction before the next render).

### 14. Holistic View

Step back and consider:

- Does the change fit well within the existing architecture?
- Are there knock-on effects on other parts of the system?
- Could this change make future work harder?
- Is there a simpler approach that achieves the same goal?
- Are naming conventions consistent with the surrounding code?

---

## Output Format

Present findings as a plan using this structure:

```markdown
## Review: [scope description]

### Issues

#### 1. [Title] — `file:line`

**Severity**: High / Medium / Low
**Category**: [React Compiler | Co-location | Duplication | Readability | Component Size | useMutation | UI Primitives | SOLID | Function Signature | TypeScript Typings | Event Handlers | State Management | General Quality | Holistic]

[Brief description with code snippet]

**Suggestion**: [Concrete fix or approach]

---

### Opportunities

- [Optional improvements that aren't strictly issues]

### What's Good

- [Positive observations — acknowledge good patterns]

### Summary

| #   | Issue | Severity | Category | File |
| --- | ----- | -------- | -------- | ---- |
| 1   | ...   | ...      | ...      | ...  |
```

### Severity Guide

- **High**: Bugs, runtime errors, security issues, missing React Compiler registration, SOLID violations causing maintenance burden, bypassing TanStack Query with ad-hoc data fetching.
- **Medium**: Co-location violations, missing UI primitives, duplication, readability issues, components > 200 lines with mixed concerns, undestructured `useMutation` usage, server state copied into local component state.
- **Low**: Style nits, minor naming inconsistencies, optional optimizations.

### Principles

- **Only review changed code** — don't flag pre-existing issues unless they interact with the change.
- **Be specific** — include file paths and line numbers.
- **Be actionable** — provide concrete fixes, not vague suggestions.
- **Be proportional** — don't over-engineer simple code.
- **Acknowledge good patterns** — note what's done well.
- **Offer to implement** — after the plan, ask if the user wants fixes applied.
