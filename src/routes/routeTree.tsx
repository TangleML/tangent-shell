import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";

import { env } from "@/shared/config/env";

import { HomePage } from "./home/HomePage";
import { NotFoundPage } from "./not-found/NotFoundPage";

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

export const routeTree = rootRoute.addChildren([indexRoute]);
