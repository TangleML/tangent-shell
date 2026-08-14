import { type Request, type Response, Router } from "express";

import type { ResourceCatalog } from "../../conversation/resourceCatalog.ts";
import { catalogWorkspaceFiles } from "../../conversation/workspaceFiles.ts";
import { getValidated, validate } from "../../middleware/validate.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import type { SessionParams } from "./schemas.ts";
import { sessionParamsSchema } from "./schemas.ts";
import { loadSession } from "./utils.ts";

/**
 * `GET /:id/resources` → the session's catalogued content. Scans the workspace
 * for `file` resources first (scan-then-list) so the returned catalog reflects
 * what is on disk at request time, then returns every catalogued resource.
 */
async function handleListResources(
  store: SessionStore,
  resources: ResourceCatalog,
  id: string,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, id);
  if (!session) return;
  await catalogWorkspaceFiles(resources, session);
  res.json({ resources: await resources.listForSession(session.id) });
}

/** Registers the resource catalog read route on a session. */
export function registerResourceRoutes(
  router: Router,
  store: SessionStore,
  resources: ResourceCatalog,
): void {
  router.get(
    "/:id/resources",
    validate({ params: sessionParamsSchema }),
    (req: Request, res: Response) =>
      handleListResources(
        store,
        resources,
        getValidated<unknown, SessionParams>(req).params.id,
        res,
      ),
  );
}
