import type {
  CreateSessionRequest,
  UpdateSessionRequest,
} from "@shared/contracts.ts";
import { type Request, type Response, Router } from "express";

import type { PiAgentManager } from "../pi/piAgentManager.ts";
import type { SessionStore } from "../store/sessionStore.ts";

export function createSessionsRouter(
  store: SessionStore,
  pi: PiAgentManager,
): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    const sessions = await store.listSessions();
    res.json({ sessions });
  });

  router.post("/", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as CreateSessionRequest;
    const session = await store.createSession({ name: body.name });
    // Spawn the session's Pi agent up front so it's ready when the chat opens.
    pi.ensure(session.id, session.rootPath);
    res.status(201).json({ session });
  });

  router.get(
    "/:id",
    async (req: Request<{ id: string }>, res: Response) => {
      const session = await store.getSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      res.json({ session });
    },
  );

  router.patch(
    "/:id",
    async (req: Request<{ id: string }>, res: Response) => {
      const body = (req.body ?? {}) as UpdateSessionRequest;
      const session = await store.updateSession(req.params.id, {
        name: body.name,
      });
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      res.json({ session });
    },
  );

  router.delete(
    "/:id",
    async (req: Request<{ id: string }>, res: Response) => {
      const deleted = await store.deleteSession(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      pi.dispose(req.params.id);
      res.status(204).end();
    },
  );

  return router;
}
