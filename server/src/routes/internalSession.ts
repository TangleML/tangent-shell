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
 * Internal API used only by the session extension running inside each Pi
 * process. It lets Prime rename the session (e.g. to a concise,
 * conversation-derived title); the server owns the session record and broadcasts
 * the change to the room. Guarded by the same bearer token as the other
 * internal APIs so arbitrary local callers can't rename a session.
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

  return router;
}
