import path from "node:path";

import type {
  CreateSessionRequest,
  UpdateSessionRequest,
} from "@shared/contracts.ts";
import { type Request, type Response, Router } from "express";

import { ARTIFACTS_DIRNAME, SESSIONS_ROOT } from "../config.ts";
import type { PiAgentManager } from "../pi/piAgentManager.ts";
import type { SessionStore } from "../store/sessionStore.ts";

/** Rejects ids that aren't a single, traversal-free path segment. */
function isUnsafeId(id: string): boolean {
  return id.includes("/") || id.includes("\\") || id.includes("..");
}

/** True when `target` is `dir` itself or sits inside it. */
function isWithin(target: string, dir: string): boolean {
  return target === dir || target.startsWith(dir + path.sep);
}

/**
 * Serves agent-produced artifacts for a session. The workspace path is
 * deterministic (`SESSIONS_ROOT/<id>`) and artifacts persist on disk, so this
 * keys off the id directly rather than the (volatile, in-memory) session
 * record — letting artifacts stay servable across server restarts.
 *
 * The splat is the path relative to the workspace root (e.g.
 * `artifacts/chart.png`), so it resolves against the root and then validates
 * the result stays within the `artifacts/` subtree. `sendFile` derives the
 * Content-Type from the extension, so images render and HTML pages (plus their
 * relative assets) resolve under the same `/files/` prefix.
 */
function createArtifactFileHandler() {
  return (
    req: Request<{ id: string; splat: string[] }>,
    res: Response,
  ): void => {
    const id = req.params.id;
    if (isUnsafeId(id)) {
      res.status(400).json({ error: "Invalid session id" });
      return;
    }

    const splat = req.params.splat;
    const rel = Array.isArray(splat) ? splat.join("/") : String(splat ?? "");

    const rootPath = path.join(SESSIONS_ROOT, id);
    const artifactsDir = path.join(rootPath, ARTIFACTS_DIRNAME);
    const target = path.resolve(rootPath, rel);
    if (!isWithin(target, artifactsDir)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Serve relative to the session root: `send` only applies its dotfile
    // check to the path after `root`, so the `.sessions` root dir doesn't
    // trip it up. `sendFile` derives the Content-Type from the extension.
    res.sendFile(rel, { root: rootPath }, (err) => {
      if (err) res.status(404).end();
    });
  };
}

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

  router.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
    const session = await store.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({ session });
  });

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

  router.get("/:id/files/*splat", createArtifactFileHandler());

  return router;
}
