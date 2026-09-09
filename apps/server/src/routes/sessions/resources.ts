import type { Resource } from "@tangent/shared/contracts.ts";
import { type Request, type Response, Router } from "express";

import type { ResourceCatalog } from "../../conversation/resourceCatalog.ts";
import { catalogWorkspaceFiles } from "../../conversation/workspaceFiles.ts";
import { getValidated, validate } from "../../middleware/validate.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import type { ListResourcesQuery, SessionParams } from "./schemas.ts";
import { listResourcesQuerySchema, sessionParamsSchema } from "./schemas.ts";
import { loadSession } from "./utils.ts";

/**
 * The catalog to surface: scoped to a Conversation + Participant's grants when
 * both are named (via {@link ResourceCatalog.surfacedFor}, which is
 * default-permissive with no grants), else the whole session catalog. This is
 * where §4.4's "should this surface for this Participant" is consulted.
 */
async function resolveResources(
  resources: ResourceCatalog,
  sessionId: string,
  query: ListResourcesQuery,
): Promise<Resource[]> {
  if (query.conversationId && query.participantId)
    return resources.surfacedFor(
      sessionId,
      query.conversationId,
      query.participantId,
    );
  return resources.listForSession(sessionId);
}

/**
 * `GET /:id/resources` → the session's catalogued content. Scans the workspace
 * for `file` resources first (scan-then-list) so the returned catalog reflects
 * what is on disk at request time, then returns the surfaced catalog — scoped to
 * a Conversation + Participant when the query names both.
 */
async function handleListResources(
  store: SessionStore,
  resources: ResourceCatalog,
  id: string,
  query: ListResourcesQuery,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, id);
  if (!session) return;
  await catalogWorkspaceFiles(resources, session);
  res.json({ resources: await resolveResources(resources, session.id, query) });
}

/** Registers the resource catalog read route on a session. */
export function registerResourceRoutes(
  router: Router,
  store: SessionStore,
  resources: ResourceCatalog,
): void {
  router.get(
    "/:id/resources",
    validate({ params: sessionParamsSchema, query: listResourcesQuerySchema }),
    (req: Request, res: Response) => {
      const { params, query } = getValidated<
        unknown,
        SessionParams,
        ListResourcesQuery
      >(req);
      return handleListResources(store, resources, params.id, query, res);
    },
  );
}
