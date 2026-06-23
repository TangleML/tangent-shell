---
name: tanstack-query
description: TanStack Query v5 patterns for data fetching, mutations, and cache management. Use when writing queries, mutations, or working with server state.
---

# TanStack Query Patterns

This project uses **TanStack Query v5** (`@tanstack/react-query`) for all server state. The shared
`QueryClient` lives at `@/shared/api/queryClient` and is provided in
`apps/web/src/routes/providers/AppProviders.tsx`.

**Prefer `useQuery` hooks over Context providers for server state.** Only reach for a Context
provider when you need to share non-query app-wide state (theme, live session status). Wrapping query
results in Context bypasses the query cache and causes unnecessary re-renders.

## File organization (feature-sliced)

Each feature owns its data layer:

- **API functions** (`fetch` + parse): `features/<feature>/api/<feature>Api.ts`
- **Query hooks**: `features/<feature>/hooks/use*.ts`
- **Query key factories**: `features/<feature>/model/<feature>QueryKeys.ts`

API functions build URLs with `apiUrl` from `@/shared/lib/basePath` (so requests resolve behind the
proxy mount-prefix) and parse into shared types from `@tangent/shared/contracts`:

```typescript
import type { AgentBundleMeta, ListAgentBundlesResponse } from "@tangent/shared/contracts";
import { apiUrl } from "@/shared/lib/basePath";

export async function listAgentBundles(): Promise<AgentBundleMeta[]> {
  const res = await fetch(apiUrl("/api/agent-bundles"));
  if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
  const data = (await res.json()) as ListAgentBundlesResponse;
  return data.bundles;
}
```

## Query Key Conventions

Use **hierarchical, array-based keys** via a per-feature factory object:

```typescript
// features/agent-bundles/model/agentBundleQueryKeys.ts
export const AgentBundleQueryKeys = {
  All: () => ["agent-bundles"] as const,
  Id: (id: string) => ["agent-bundles", id] as const,
} as const;
```

## Query Hooks

Define queries **inline in custom hooks** — this project does not use the `queryOptions` helper:

```typescript
import { useQuery } from "@tanstack/react-query";
import { listAgentBundles } from "@/features/agent-bundles/api/agentBundlesApi";
import { AgentBundleQueryKeys } from "@/features/agent-bundles/model/agentBundleQueryKeys";

export function useAgentBundles() {
  return useQuery({
    queryKey: AgentBundleQueryKeys.All(),
    queryFn: listAgentBundles,
  });
}
```

Set `staleTime` to match data volatility, and use `enabled` for dependent queries:

```typescript
return useQuery({
  queryKey: AgentBundleQueryKeys.Id(id),
  queryFn: () => getAgentBundle(id),
  enabled: !!id,
  staleTime: 5 * 60 * 1000,
});
```

## Mutation Pattern

Invalidate the relevant keys on success and let the queries refetch. This project uses
**post-mutation invalidation**, not optimistic updates — don't use `setQueryData` to fake results.

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteAgentBundle } from "@/features/agent-bundles/api/agentBundlesApi";
import { AgentBundleQueryKeys } from "@/features/agent-bundles/model/agentBundleQueryKeys";

export function useDeleteAgentBundle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAgentBundle,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AgentBundleQueryKeys.All() });
    },
  });
}
```

Multiple invalidations in one `onSuccess` are fine. There is **no global toast/notify utility** —
surface mutation failures through the component's `isError`/`error` state (or an error boundary),
not a `notify()` call.

## QueryClient methods

- `queryClient.invalidateQueries()` — primary cache invalidation
- `queryClient.getQueryData()` — read cache without refetching
- `queryClient.ensureQueryData()` — fetch-if-not-cached for dependent/recursive data

## Polling with dynamic intervals

Use a function for `refetchInterval` to stop polling once work is complete:

```typescript
refetchInterval: (query) => {
  const status = query.state.data?.status;
  return status === "RUNNING" ? 5000 : false;
},
```

## Live data over sockets

Some state is pushed, not polled. Session chat/status uses `socket.io-client` (see
`features/chat/hooks/useSessionChat.ts` and `features/sessions/components/SessionStatusProvider.tsx`)
rather than a polling query. Use a query for request/response data; use the socket for streaming
updates.
