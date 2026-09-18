import { type Request, type Response, Router } from "express";
import { z } from "zod";

import type { ResourceCatalog } from "../conversation/resourceCatalog.ts";
import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import { loadSession } from "./sessions/utils.ts";

/** `GET /read` query: the session whose resources to read. */
const readQuerySchema = z.object({
  sessionId: z.string(),
});
type ReadQuery = z.infer<typeof readQuerySchema>;

/**
 * `GET /read`: returns the session's host resources so an agent can see host
 * entries added after it spawned (the spawn preamble is static). Memory has its
 * own `read_memory` tool, so only `host` rows are returned here.
 */
async function handleRead(
  store: SessionStore,
  resources: ResourceCatalog,
  query: ReadQuery,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, query.sessionId);
  if (!session) return;
  const all = await resources.listForSession(session.id);
  res.json({ resources: all.filter((resource) => resource.kind === "host") });
}

/**
 * Internal API used only by the resources extension running inside each Pi
 * process. It lets any agent re-read the session's host resources, which can be
 * added or removed after the agent spawned. Guarded by the same bearer token as
 * the other internal APIs.
 */
export function createInternalResourcesRouter(
  store: SessionStore,
  resources: ResourceCatalog,
): Router {
  const router = Router();

  router.use(requireInternalToken);

  router.get(
    "/read",
    validate({ query: readQuerySchema }),
    (req: Request, res: Response) =>
      handleRead(
        store,
        resources,
        getValidated<unknown, unknown, ReadQuery>(req).query,
        res,
      ),
  );

  return router;
}
