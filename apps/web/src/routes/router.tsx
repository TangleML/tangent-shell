import { createBrowserHistory } from "@tanstack/history";
import { createRouter } from "@tanstack/react-router";

import { BASE_PREFIX } from "@/shared/lib/basePath";

import { routeTree } from "./routeTree";

export const router = createRouter({
  routeTree,
  history: createBrowserHistory(),
  // Mount the router under the proxy sub-path so client-side routing resolves
  // relative to the tangle pod-proxy prefix (`/` at the origin root).
  basepath: BASE_PREFIX,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
