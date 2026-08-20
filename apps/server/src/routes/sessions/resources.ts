import type { Resource } from "@tangent/shared/contracts.ts";
import { type Request, type Response, Router } from "express";

import { resolveUserIdentity } from "../../auth/identity.ts";
import {
  applyResourceInput,
  removeResourceByUri,
  type ResourceSeedDeps,
} from "../../conversation/hostResources.ts";
import type { ResourceCatalog } from "../../conversation/resourceCatalog.ts";
import { catalogWorkspaceFiles } from "../../conversation/workspaceFiles.ts";
import { getValidated, validate } from "../../middleware/validate.ts";
import type { HostResourcePreamble } from "../../pi/hostResourcePreamble.ts";
import type { MemoryManager } from "../../pi/memory.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import type {
  DeleteResourceQuery,
  HostResourceInputBody,
  ListResourcesQuery,
  SessionParams,
} from "./schemas.ts";
import {
  deleteResourceQuerySchema,
  hostResourceInputSchema,
  listResourcesQuerySchema,
  sessionParamsSchema,
} from "./schemas.ts";
import { loadSession } from "./utils.ts";

/** Everything the resource routes need to read, write, and surface the catalog. */
export interface ResourceRouteDeps {
  store: SessionStore;
  resources: ResourceCatalog;
  memory: MemoryManager;
  hostPreamble: HostResourcePreamble;
  /** Notifies a session's room that its resource catalog changed. */
  emitResourcesUpdated: (sessionId: string) => void;
}

/** The seed deps drawn from the route deps. */
function seedDeps(deps: ResourceRouteDeps): ResourceSeedDeps {
  return { store: deps.store, memory: deps.memory, catalog: deps.resources };
}

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
  deps: ResourceRouteDeps,
  id: string,
  query: ListResourcesQuery,
  res: Response,
): Promise<void> {
  const session = await loadSession(deps.store, res, id);
  if (!session) return;
  await catalogWorkspaceFiles(deps.resources, session);
  res.json({
    resources: await resolveResources(deps.resources, session.id, query),
  });
}

/**
 * `POST /:id/resources` → adds a host-owned resource (a memory write or a host
 * entry). Refreshes the spawn preamble and signals the room so open clients
 * refetch. Returns the stored resource.
 */
async function handleAddResource(
  deps: ResourceRouteDeps,
  id: string,
  body: HostResourceInputBody,
  req: Request,
  res: Response,
): Promise<void> {
  const session = await loadSession(deps.store, res, id);
  if (!session) return;

  const author =
    body.kind === "host"
      ? resolveUserIdentity(req.headers.cookie, req.headers.authorization)
          ?.email
      : undefined;
  const resource = await applyResourceInput(
    seedDeps(deps),
    session.id,
    session.rootPath,
    body,
    author,
  );
  await deps.hostPreamble.refresh(session.id);
  deps.emitResourcesUpdated(session.id);
  res.status(201).json({ resource });
}

/**
 * `DELETE /:id/resources?uri=...` → drops a host-owned resource. Removing a
 * memory store's entry also empties the store so the agent's `read_memory` and
 * the catalog stay consistent.
 */
async function handleRemoveResource(
  deps: ResourceRouteDeps,
  id: string,
  query: DeleteResourceQuery,
  res: Response,
): Promise<void> {
  const session = await loadSession(deps.store, res, id);
  if (!session) return;
  await removeResourceByUri(
    seedDeps(deps),
    session.id,
    session.rootPath,
    query.uri,
  );
  await deps.hostPreamble.refresh(session.id);
  deps.emitResourcesUpdated(session.id);
  res.status(204).end();
}

/** Registers the resource catalog read/write routes on a session. */
export function registerResourceRoutes(
  router: Router,
  deps: ResourceRouteDeps,
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
      return handleListResources(deps, params.id, query, res);
    },
  );

  router.post(
    "/:id/resources",
    validate({ params: sessionParamsSchema, body: hostResourceInputSchema }),
    (req: Request, res: Response) => {
      const { params, body } = getValidated<
        HostResourceInputBody,
        SessionParams
      >(req);
      return handleAddResource(deps, params.id, body, req, res);
    },
  );

  router.delete(
    "/:id/resources",
    validate({
      params: sessionParamsSchema,
      query: deleteResourceQuerySchema,
    }),
    (req: Request, res: Response) => {
      const { params, query } = getValidated<
        unknown,
        SessionParams,
        DeleteResourceQuery
      >(req);
      return handleRemoveResource(deps, params.id, query, res);
    },
  );
}
