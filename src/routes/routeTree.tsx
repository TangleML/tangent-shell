import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";

import { env } from "@/shared/config/env";

import { HomePage } from "./home/HomePage";
import { NotFoundPage } from "./not-found/NotFoundPage";
import { SessionChatPage } from "./sessions/SessionChatPage";
import { SessionsPage } from "./sessions/SessionsPage";

function RootLayout() {
  return (
    <>
      <Outlet />
      {env.isDev ? <TanStackRouterDevtools /> : null}
    </>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions",
  component: SessionsPage,
});

const sessionChatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions/$sessionId",
  component: SessionChatPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  sessionsRoute,
  sessionChatRoute,
]);
