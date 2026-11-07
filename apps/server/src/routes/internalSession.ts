import { normalizePinnableUrl } from "@tangent/shared/pinnableUrl.ts";
import { type Request, type Response, Router } from "express";
import { z, type ZodType } from "zod";

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

/** An http(s) URL without credentials, normalized to its canonical form. */
const pinnableUrl = z.string().transform((raw, ctx) => {
  const url = normalizePinnableUrl(raw);
  if (url) return url;
  ctx.addIssue({
    code: "custom",
    message:
      "url must be an absolute http(s) URL without credentials, at most 2048 characters",
  });
  return z.NEVER;
});

/** Pin-link body: an external http(s) `url` with an optional `title`. */
export const pinLinkSchema = z.object({
  sessionId: z.string(),
  url: pinnableUrl,
  title: z.string().optional(),
});
export type PinLinkInput = z.infer<typeof pinLinkSchema>;

/** Unpin-link body: the `url` to remove, matched in canonical form. */
export const unpinLinkSchema = z.object({
  sessionId: z.string(),
  url: pinnableUrl,
});
export type UnpinLinkInput = z.infer<typeof unpinLinkSchema>;

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
 * `POST /pin-link`: pins an external link (validated and canonicalized by the
 * schema, so the same URL dedupes) and broadcasts the updated list to the UI.
 */
async function handlePinLink(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  body: PinLinkInput,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, body.sessionId);
  if (!session) return;

  const artifacts = await store.pinLink(session.id, {
    url: body.url,
    title: fallbackTitle(body.title, new URL(body.url).host),
  });
  emitUiCommand(session.id, { kind: "artifacts.update", artifacts });
  res.json({ artifacts });
}

/** `POST /unpin-link`: unpins a link by URL and broadcasts the updated list. */
async function handleUnpinLink(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  body: UnpinLinkInput,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, body.sessionId);
  if (!session) return;

  const artifacts = await store.unpinLink(session.id, body.url);
  emitUiCommand(session.id, { kind: "artifacts.update", artifacts });
  res.json({ artifacts });
}

/** A body handler for one internal-session route, run after validation. */
type SessionRouteHandler<B> = (
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  body: B,
  res: Response,
) => Promise<void>;

/**
 * Internal API used only by the session extension running inside each Pi
 * process. It lets Prime rename the session (e.g. to a concise,
 * conversation-derived title) and lets any agent pin/unpin artifacts and
 * external links for quick access; the server owns the session record and
 * broadcasts changes to the room. Guarded by the same bearer token as the
 * other internal APIs so arbitrary local callers can't mutate a session.
 */
export function createInternalSessionRouter(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
): Router {
  const router = Router();

  router.use(requireInternalToken);

  const post = <B>(
    path: string,
    schema: ZodType<B>,
    handler: SessionRouteHandler<B>,
  ): void => {
    router.post(
      path,
      validate({ body: schema }),
      (req: Request, res: Response) =>
        handler(store, emitUiCommand, getValidated<B>(req).body, res),
    );
  };

  post("/rename", renameSchema, handleRename);
  post("/pin-artifact", pinArtifactSchema, handlePinArtifact);
  post("/unpin-artifact", unpinArtifactSchema, handleUnpinArtifact);
  post("/pin-link", pinLinkSchema, handlePinLink);
  post("/unpin-link", unpinLinkSchema, handleUnpinLink);

  return router;
}
