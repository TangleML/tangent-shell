import { createBrowserHistory } from "@tanstack/history";
import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree";

export const router = createRouter({
  routeTree,
  history: createBrowserHistory(),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
