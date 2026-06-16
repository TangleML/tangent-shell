import {
  createRootRoute,
  createRoute,
  Outlet,
  redirect,
} from "@tanstack/react-router";

import { env } from "@/shared/config/env";
import { AppShell } from "@/shared/ui/patterns/app-shell";

import { AgentBundlesPage } from "./agent-bundles/AgentBundlesPage";
import { BundleUiHarnessPage } from "./bundle-ui-harness/BundleUiHarnessPage";
import { AppTopNav } from "./layout/AppTopNav";
import { NotFoundPage } from "./not-found/NotFoundPage";
import { SessionChatPage } from "./sessions/SessionChatPage";
import { SessionsPage } from "./sessions/SessionsPage";

function RootLayout() {
  return (
    <>
      <Outlet />
    </>
  );
}

function AppLayout() {
  return (
    <AppShell topBar={<AppTopNav />}>
      <Outlet />
    </AppShell>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

// Pathless layout route: renders the persistent app shell (top nav + working
// area) around every page below it.
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AppLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/sessions" });
  },
});

const sessionsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/sessions",
  component: SessionsPage,
});

const sessionChatRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/sessions/$sessionId",
  component: SessionChatPage,
});

const agentBundlesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/agent-bundles",
  component: AgentBundlesPage,
});

// Dev-only harness for the bundle-UI sandbox runtime (Phase 5).
const bundleUiHarnessRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/bundle-ui-harness",
  component: BundleUiHarnessPage,
});

export const routeTree = rootRoute.addChildren([
  appLayoutRoute.addChildren([
    indexRoute,
    sessionsRoute,
    sessionChatRoute,
    agentBundlesRoute,
    ...(env.isDev ? [bundleUiHarnessRoute] : []),
  ]),
]);
