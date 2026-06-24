---
name: tanstack-router
description: TanStack Router patterns for routing, navigation, search params, and layouts. Use when creating routes, navigating, or working with URL state.
---

# TanStack Router Patterns

This project uses **code-based routing** (not file-based) with TanStack Router v1.

## Route definitions

Routes are defined in `apps/web/src/routes/routeTree.tsx` with `createRootRoute` / `createRoute`,
then assembled with `addChildren`. A **pathless layout route** (`id: "app"`) renders the persistent
`AppShell` around every page:

```typescript
const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AppLayout, // <AppShell topBar={<AppTopNav />}><Outlet /></AppShell>
});

const sessionsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/sessions",
  component: SessionsPage,
});

export const routeTree = rootRoute.addChildren([
  appLayoutRoute.addChildren([
    indexRoute, // path "/" → redirect to "/sessions"
    sessionsRoute,
    sessionChatRoute, // "/sessions/$sessionId"
    agentBundlesRoute, // "/agent-bundles"
    globalMemoryRoute, // "/global-memory"
    ...(env.isDev ? [bundleUiHarnessRoute] : []), // dev-only "/bundle-ui-harness"
  ]),
]);
```

Paths are plain string literals on each route — there is **no `APP_ROUTES` constant**. Routes
conditionally mounted for dev use `env.isDev` from `@/shared/config/env`.

## Router config

`apps/web/src/routes/router.tsx` creates the router. It mounts under the proxy sub-path via
`BASE_PREFIX` (from `@/shared/lib/basePath`) so client routing resolves behind the oasis pod-proxy:

```typescript
export const router = createRouter({
  routeTree,
  history: createBrowserHistory(),
  basepath: BASE_PREFIX,
  defaultPreload: "intent", // preload on hover/focus
});
```

## Redirects

Use `beforeLoad` for redirects and simple param extraction (this project does **not** use route
`loader`s — fetch with query hooks in components instead):

```typescript
const indexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/sessions" });
  },
});
```

## Navigation

```typescript
const navigate = useNavigate();
navigate({ to: "/sessions/$sessionId", params: { sessionId } });
```

For nav links, use the design-system `TopNav` / `TopNavLink` patterns (which wrap the router `Link`)
rather than styling a raw `Link` — remember the no-`className`-on-primitives rule:

```tsx
import { Link } from "@tanstack/react-router";
import { TopNav, TopNavLink } from "@/shared/ui/patterns/top-nav";

<TopNav
  brand={
    <Link to="/sessions">
      <Text size="lg" weight="bold">
        Tangent Shell
      </Text>
    </Link>
  }
  links={
    <>
      <TopNavLink to="/sessions">Sessions</TopNavLink>
      <TopNavLink to="/agent-bundles">Agent bundles</TopNavLink>
    </>
  }
/>;
```

## Route params

Read typed params with the `from` option pointing at the route's full path id:

```typescript
const { sessionId } = useParams({ from: "/app/sessions/$sessionId" });
```

## Search params

For query/search state, use `useSearch`. Validate with **type guards**, not Zod, and read
loosely-typed search with `useSearch({ strict: false })` when a route doesn't declare a
`validateSearch`. Keep dynamic values (ids, counts) in params/search, not in path constants.

## Router hooks

| Hook                               | Use case                         |
| ---------------------------------- | -------------------------------- |
| `useNavigate()`                    | Programmatic navigation          |
| `useParams({ from })`              | Route params (`$sessionId`)      |
| `useSearch({ strict: false })`     | Search/query params              |
| `useLocation()`                    | Current pathname                 |
| `useRouter()` / `useRouterState()` | Router instance / advanced state |

## Layout nesting

Layouts render `<Outlet />` for children. The current tree:

```
rootRoute (RootLayout, notFoundComponent: NotFoundPage)
└── appLayoutRoute  (AppLayout: AppShell + AppTopNav + Outlet)
    ├── indexRoute            "/"            → redirect "/sessions"
    ├── sessionsRoute         "/sessions"
    ├── sessionChatRoute      "/sessions/$sessionId"
    ├── agentBundlesRoute     "/agent-bundles"
    ├── globalMemoryRoute     "/global-memory"
    └── bundleUiHarnessRoute  "/bundle-ui-harness"   (dev only)
```
