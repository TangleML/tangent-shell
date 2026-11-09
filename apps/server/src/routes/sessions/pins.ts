import type { Request, Response, Router } from "express";
import { z } from "zod";

import { getValidated, validate } from "../../middleware/validate.ts";
import type { UiCommandEmitter } from "../../sockets/sessionRoster.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import { type SessionParams, sessionParamsSchema } from "./schemas.ts";
import { loadSession } from "./utils.ts";

const pinBodySchema = z.object({
  path: z.string().trim().min(1),
  title: z.string().optional(),
});
type PinBody = z.infer<typeof pinBodySchema>;

const unpinQuerySchema = z.object({
  path: z.string().trim().min(1),
});
type UnpinQuery = z.infer<typeof unpinQuerySchema>;

/**
 * Pins and unpins a session's files from outside the chat, as the chat's own
 * pin toggle does over the socket, so a host page can let someone choose what
 * is ready to share. The session's room hears about it like any other pin.
 */
export function registerPinRoutes(
  router: Router,
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
): void {
  router.post(
    "/:id/pins",
    validate({ params: sessionParamsSchema, body: pinBodySchema }),
    async (req: Request, res: Response) => {
      const { params, body } = getValidated<PinBody, SessionParams>(req);
      const session = await loadSession(store, res, params.id);
      if (!session) return;
      const artifacts = await store.pinArtifact(session.id, {
        path: body.path,
        title: body.title?.trim() || body.path,
      });
      emitUiCommand(session.id, { kind: "artifacts.update", artifacts });
      res.json({ artifacts });
    },
  );

  router.delete(
    "/:id/pins",
    validate({ params: sessionParamsSchema, query: unpinQuerySchema }),
    async (req: Request, res: Response) => {
      const { params, query } = getValidated<
        unknown,
        SessionParams,
        UnpinQuery
      >(req);
      const session = await loadSession(store, res, params.id);
      if (!session) return;
      const artifacts = await store.unpinArtifact(session.id, query.path);
      emitUiCommand(session.id, { kind: "artifacts.update", artifacts });
      res.status(204).end();
    },
  );
}
