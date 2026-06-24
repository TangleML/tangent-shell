import { type Request, type Response, Router } from "express";

import { getValidated, validate } from "../../middleware/validate.ts";
import type { PiAgentManager } from "../../pi/piAgentManager.ts";
import type { TriggerEngine } from "../../pi/triggers/triggerEngine.ts";
import type { TriggerManager } from "../../pi/triggers/triggerManager.ts";
import type { AgentBundleStore } from "../../store/agentBundleStore.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import { bundleUpload } from "../bundleUpload.ts";
import {
  createArtifactFileHandler,
  handleCreateSession,
  handleDeleteSession,
  handleGetSession,
  handleListSessions,
  handleMarkSessionViewed,
  handleUpdateSession,
  handleUploadFiles,
  uploadFiles,
} from "./handlers.ts";
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

/** Registers the session collection routes (`GET /` list, `POST /` create). */
function registerSessionCollectionRoutes(
  router: Router,
  store: SessionStore,
  pi: PiAgentManager,
  triggerEngine: TriggerEngine,
  agentBundleStore: AgentBundleStore,
): void {
  router.get("/", (req: Request, res: Response) =>
    handleListSessions(store, req, res),
  );

  // `bundleUpload.single` parses a multipart `config` ZIP (form field `name`
  // lands in `req.body`); plain JSON requests pass through untouched (parsed
  // earlier by the global `express.json()`). `validate` then narrows the body
  // either way, while the uploaded file is read from `req.file`.
  router.post(
    "/",
    bundleUpload.single("config"),
    validate({ body: createSessionSchema }),
    (req: Request, res: Response) =>
      handleCreateSession(
        store,
        pi,
        triggerEngine,
        agentBundleStore,
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
): Router {
  const router = Router();

  registerSessionCollectionRoutes(
    router,
    store,
    pi,
    triggerEngine,
    agentBundleStore,
  );
  registerSessionItemRoutes(router, store, pi, triggerEngine);
  registerSessionActivityRoutes(router, store);
  registerTriggerRoutes(router, store, triggers, triggerEngine);

  // Declared after the trigger routes so the `*splat` catch-all doesn't shadow
  // the more specific `/:id/triggers/...` paths.
  router.get("/:id/files/*splat", createArtifactFileHandler());

  return router;
}
