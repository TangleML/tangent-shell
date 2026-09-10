import { type Request, type Response, Router } from "express";

import type { ParticipantService } from "../../conversation/participantService.ts";
import type { ResourceCatalog } from "../../conversation/resourceCatalog.ts";
import { getValidated, validate } from "../../middleware/validate.ts";
import type { HostResourcePreamble } from "../../pi/hostResourcePreamble.ts";
import type { MemoryManager } from "../../pi/memory.ts";
import type { PiAgentManager } from "../../pi/piAgentManager.ts";
import type { TriggerEngine } from "../../pi/triggers/triggerEngine.ts";
import type { TriggerManager } from "../../pi/triggers/triggerManager.ts";
import type { AgentBundleStore } from "../../store/agentBundleStore.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import {
  createArtifactFileHandler,
  handleCreateSession,
  handleDeleteSession,
  handleGetSession,
  handleListSessions,
  handleMarkSessionViewed,
  handleUpdateSession,
  handleUploadFiles,
  type SessionCreateDeps,
  uploadFiles,
} from "./handlers.ts";
import { registerParticipantRoutes } from "./participants.ts";
import { registerResourceRoutes } from "./resources.ts";
import type {
  CreateSessionInput,
  SessionParams,
  UpdateSessionInput,
} from "./schemas.ts";
import {
  createSessionSchema,
  sessionParamsSchema,
  updateSessionSchema,
} from "./schemas.ts";
import { registerTriggerRoutes } from "./triggers.ts";
import { registerWorkflowRoutes, type WorkflowRouteDeps } from "./workflow.ts";

/** Registers the session collection routes (`GET /` list, `POST /` create). */
function registerSessionCollectionRoutes(
  router: Router,
  createDeps: SessionCreateDeps,
): void {
  router.get("/", (req: Request, res: Response) =>
    handleListSessions(createDeps.store, req, res),
  );

  router.post(
    "/",
    validate({ body: createSessionSchema }),
    (req: Request, res: Response) =>
      handleCreateSession(
        createDeps,
        req,
        getValidated<CreateSessionInput>(req).body,
        res,
      ),
  );
}

/** Registers the single-session item routes (read/update/delete/upload). */
function registerSessionItemRoutes(
  router: Router,
  store: SessionStore,
  pi: PiAgentManager,
  triggerEngine: TriggerEngine,
): void {
  router.get(
    "/:id",
    validate({ params: sessionParamsSchema }),
    (req: Request, res: Response) =>
      handleGetSession(
        store,
        getValidated<unknown, SessionParams>(req).params.id,
        res,
      ),
  );

  router.patch(
    "/:id",
    validate({ params: sessionParamsSchema, body: updateSessionSchema }),
    (req: Request, res: Response) => {
      const { params, body } = getValidated<UpdateSessionInput, SessionParams>(
        req,
      );
      return handleUpdateSession(store, params.id, body, res);
    },
  );

  router.delete(
    "/:id",
    validate({ params: sessionParamsSchema }),
    (req: Request, res: Response) =>
      handleDeleteSession(
        store,
        pi,
        triggerEngine,
        getValidated<unknown, SessionParams>(req).params.id,
        res,
      ),
  );
}

/** Registers the routes that record activity against a single session. */
function registerSessionActivityRoutes(
  router: Router,
  store: SessionStore,
): void {
  router.post(
    "/:id/viewed",
    validate({ params: sessionParamsSchema }),
    (req: Request, res: Response) =>
      handleMarkSessionViewed(
        store,
        req,
        getValidated<unknown, SessionParams>(req).params.id,
        res,
      ),
  );

  // Uploads land in the session's `uploads/` folder; `uploadFiles.array` writes
  // each file to disk before the handler records the resulting metadata.
  router.post(
    "/:id/files",
    validate({ params: sessionParamsSchema }),
    uploadFiles.array("files"),
    (req: Request<SessionParams>, res: Response) =>
      handleUploadFiles(store, req, res),
  );
}

export function createSessionsRouter(
  store: SessionStore,
  pi: PiAgentManager,
  triggers: TriggerManager,
  triggerEngine: TriggerEngine,
  agentBundleStore: AgentBundleStore,
  participants: ParticipantService,
  resources: ResourceCatalog,
  memory: MemoryManager,
  hostPreamble: HostResourcePreamble,
  emitResourcesUpdated: (sessionId: string) => void,
  workflow: WorkflowRouteDeps,
): Router {
  const router = Router();

  const createDeps: SessionCreateDeps = {
    store,
    pi,
    triggerEngine,
    agentBundleStore,
    memory,
    resources,
    hostPreamble,
    emitResourcesUpdated,
  };

  registerSessionCollectionRoutes(router, createDeps);
  registerSessionItemRoutes(router, store, pi, triggerEngine);
  registerSessionActivityRoutes(router, store);
  registerTriggerRoutes(router, store, triggers, triggerEngine);
  registerParticipantRoutes(router, store, participants);
  registerResourceRoutes(router, {
    store,
    resources,
    memory,
    hostPreamble,
    emitResourcesUpdated,
  });
  registerWorkflowRoutes(router, workflow);

  // Declared after the trigger routes so the `*splat` catch-all doesn't shadow
  // the more specific `/:id/triggers/...` paths.
  router.get("/:id/files/*splat", createArtifactFileHandler());

  return router;
}
