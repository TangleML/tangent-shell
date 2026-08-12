import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import type { UiCommandEmitter } from "../sockets/sessionRoster.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import { loadSession } from "./sessions/utils.ts";

/** Rename body: a non-empty trimmed `name` applied to the given session. */
export const renameSchema = z.object({
  sessionId: z.string(),
  name: z.string().trim().min(1),
});
export type RenameInput = z.infer<typeof renameSchema>;

/** Pin-artifact body: a workspace-relative `path` with an optional `title`. */
export const pinArtifactSchema = z.object({
  sessionId: z.string(),
  path: z.string().trim().min(1),
  title: z.string().optional(),
});
export type PinArtifactInput = z.infer<typeof pinArtifactSchema>;

/** Unpin-artifact body: the workspace-relative `path` to remove. */
export const unpinArtifactSchema = z.object({
  sessionId: z.string(),
  path: z.string().trim().min(1),
});
export type UnpinArtifactInput = z.infer<typeof unpinArtifactSchema>;

/**
 * `POST /rename`: applies a session rename and pushes the updated record to the
 * UI over the generic `ui:command` channel so the change is reflected promptly.
 */
async function handleRename(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  body: RenameInput,
  res: Response,
): Promise<void> {
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

/** Returns a trimmed title, falling back to the path when none was given. */
function fallbackTitle(title: string | undefined, path: string): string {
  return title?.trim() || path;
}

/**
 * `POST /pin-artifact`: pins an artifact (by workspace-relative path) for quick
 * access and broadcasts the updated list to the UI over the generic
 * `ui:command` channel.
 */
async function handlePinArtifact(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  body: PinArtifactInput,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, body.sessionId);
  if (!session) return;

  const title = fallbackTitle(body.title, body.path);
  const artifacts = await store.pinArtifact(session.id, {
    path: body.path,
    title,
  });
  emitUiCommand(session.id, { kind: "artifacts.update", artifacts });
  res.json({ artifacts });
}

/**
 * `POST /unpin-artifact`: unpins an artifact by path and broadcasts the updated
 * list to the UI.
 */
async function handleUnpinArtifact(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  body: UnpinArtifactInput,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, body.sessionId);
  if (!session) return;

  const artifacts = await store.unpinArtifact(session.id, body.path);
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

  router.post(
    "/rename",
    validate({ body: renameSchema }),
    (req: Request, res: Response) =>
      handleRename(
        store,
        emitUiCommand,
        getValidated<RenameInput>(req).body,
        res,
      ),
  );

  router.post(
    "/pin-artifact",
    validate({ body: pinArtifactSchema }),
    (req: Request, res: Response) =>
      handlePinArtifact(
        store,
        emitUiCommand,
        getValidated<PinArtifactInput>(req).body,
        res,
      ),
  );

  router.post(
    "/unpin-artifact",
    validate({ body: unpinArtifactSchema }),
    (req: Request, res: Response) =>
      handleUnpinArtifact(
        store,
        emitUiCommand,
        getValidated<UnpinArtifactInput>(req).body,
        res,
      ),
  );

  return router;
}
