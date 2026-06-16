import {
  type NextFunction,
  type Request,
  type Response,
  Router,
} from "express";

import { INTERNAL_TOKEN } from "../config.ts";
import type { UiCommandEmitter } from "../sockets/chat.ts";
import type { SessionStore } from "../store/sessionStore.ts";

interface RenameBody {
  sessionId?: string;
  name?: string;
}

interface PinArtifactBody {
  sessionId?: string;
  path?: string;
  title?: string;
}

interface UnpinArtifactBody {
  sessionId?: string;
  path?: string;
}

/** Rejects any request not bearing the shared internal token. */
function requireInternalToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.get("authorization") !== `Bearer ${INTERNAL_TOKEN}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/**
 * `POST /rename`: applies a session rename and pushes the updated record to the
 * UI over the generic `ui:command` channel so the change is reflected promptly.
 */
async function handleRename(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  req: Request,
  res: Response,
): Promise<void> {
  const body = (req.body ?? {}) as RenameBody;
  if (!body.sessionId || !body.name?.trim()) {
    res.status(400).json({ error: "sessionId and name are required" });
    return;
  }

  const session = await store.updateSession(body.sessionId, {
    name: body.name,
  });
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  emitUiCommand(session.id, { kind: "session.update", session });
  res.json({ session });
}

/**
 * `POST /pin-artifact`: pins an artifact (by workspace-relative path) for quick
 * access and broadcasts the updated list to the UI over the generic
 * `ui:command` channel.
 */
async function handlePinArtifact(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  req: Request,
  res: Response,
): Promise<void> {
  const body = (req.body ?? {}) as PinArtifactBody;
  const path = body.path?.trim();
  if (!body.sessionId || !path) {
    res.status(400).json({ error: "sessionId and path are required" });
    return;
  }

  const session = await store.getSession(body.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const title = fallbackTitle(body.title, path);
  const artifacts = await store.pinArtifact(session.id, { path, title });
  emitUiCommand(session.id, { kind: "artifacts.update", artifacts });
  res.json({ artifacts });
}

/** Returns a trimmed title, falling back to the path when none was given. */
function fallbackTitle(title: string | undefined, path: string): string {
  return title?.trim() || path;
}

/**
 * `POST /unpin-artifact`: unpins an artifact by path and broadcasts the updated
 * list to the UI.
 */
async function handleUnpinArtifact(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  req: Request,
  res: Response,
): Promise<void> {
  const body = (req.body ?? {}) as UnpinArtifactBody;
  const path = body.path?.trim();
  if (!body.sessionId || !path) {
    res.status(400).json({ error: "sessionId and path are required" });
    return;
  }

  const session = await store.getSession(body.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const artifacts = await store.unpinArtifact(session.id, path);
  emitUiCommand(session.id, { kind: "artifacts.update", artifacts });
  res.json({ artifacts });
}

/**
 * Internal API used only by the session extension running inside each Pi
 * process. It lets Prime rename the session (e.g. to a concise,
 * conversation-derived title) and lets any agent pin/unpin artifacts for quick
 * access; the server owns the session record and broadcasts changes to the
 * room. Guarded by the same bearer token as the other internal APIs so
 * arbitrary local callers can't mutate a session.
 */
export function createInternalSessionRouter(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
): Router {
  const router = Router();

  router.use(requireInternalToken);

  router.post("/rename", (req: Request, res: Response) =>
    handleRename(store, emitUiCommand, req, res),
  );

  router.post("/pin-artifact", (req: Request, res: Response) =>
    handlePinArtifact(store, emitUiCommand, req, res),
  );

  router.post("/unpin-artifact", (req: Request, res: Response) =>
    handleUnpinArtifact(store, emitUiCommand, req, res),
  );

  return router;
}
