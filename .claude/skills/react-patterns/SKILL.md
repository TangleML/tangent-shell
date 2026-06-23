---
name: react-patterns
description: React and React Compiler patterns for this project. Use when writing React components, hooks, providers, or working with React Compiler compatibility.
---

# React Patterns

## Core Rules

- Use functional components with hooks exclusively (no class components).
- Use proper dependency arrays in `useEffect`.
- Use React 19 features and patterns.
- **Import named members from React** (`import { useState } from "react"`); don't write inline
  `React.useState`.

## Component Structure

```typescript
// ComponentName.tsx — import directly, no index.ts barrel
interface ComponentNameProps {
  // props
}

export const ComponentName = ({ }: ComponentNameProps) => {
  // component logic
  return (
    // JSX
  );
};
```

## Custom Hooks

- Prefix with `use`.
- Return objects for multiple values, not arrays.
- Use proper TypeScript return types.
- Hooks are **co-located with the feature** that owns them, under
  `apps/web/src/features/<feature>/hooks/` (e.g. `features/agent-bundles/hooks/useAgentBundles.ts`).

## Provider Pattern

```typescript
const Context = createContext<ContextType | null>(null);

export const Provider = ({ children }: { children: ReactNode }) => {
  // provider logic
  return <Context.Provider value={value}>{children}</Context.Provider>;
};

export const useMyContext = () => {
  const context = useContext(Context);
  if (!context) throw new Error("useMyContext must be used within Provider");
  return context;
};
```

App-wide providers are composed in `apps/web/src/routes/providers/AppProviders.tsx`
(`ErrorBoundary > ThemeProvider > QueryClientProvider > SessionStatusProvider`). Feature-scoped
providers live with their feature (e.g. `features/sessions/components/SessionStatusProvider.tsx`).

## State Management

- Use **TanStack Query** for server state (see `tanstack-query` skill).
- Use **TanStack Router** for routing (see `tanstack-router` skill).
- Use React hooks for local component state.
- Use Context providers only for genuinely app-wide non-query state (theme, live session status).
  Don't wrap query results in Context — it bypasses the query cache.

## React Compiler

This project uses the **React Compiler**, wired in globally as a Babel preset in
`apps/web/vite.config.ts` (`babel({ presets: [reactCompilerPreset()] })`). It applies to the whole
`apps/web` source tree — there is **no** `react-compiler.config.js` and no per-file opt-in list.
Write compiler-compatible code everywhere.

### Writing React Compiler compatible code

1. **Don't mutate values during render**

   ```typescript
   // Bad — mutating during render
   const items = props.items;
   items.push(newItem);

   // Good — create a new reference
   const items = [...props.items, newItem];
   ```

2. **Don't read/write refs during render**

   ```typescript
   // Bad — reading ref during render
   const value = myRef.current;

   // Good — read refs in effects or callbacks
   useEffect(() => {
     const value = myRef.current;
   }, []);
   ```

3. **Follow the Rules of Hooks strictly** — no conditional hooks, no hooks in loops, proper
   dependency arrays.

4. **Avoid patterns the compiler can't optimize** — unnecessary `{...props}` spreads, dynamic
   property access where avoidable. Keep component logic predictable.

## Performance

- **Do not hand-write `useMemo`, `useCallback`, or `memo`** — the React Compiler handles memoization
  automatically. Remove them if you encounter them.
- Lazy-load heavy components when it helps.
- Verify there are no compiler violations with `pnpm validate`.
