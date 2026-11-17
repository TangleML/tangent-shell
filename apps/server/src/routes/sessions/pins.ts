import type { Request, Response, Router } from "express";
import type { z } from "zod";

import { getValidated, validate } from "../../middleware/validate.ts";
import {
  pinAndBroadcast,
  unpinAndBroadcast,
} from "../../sockets/chatArtifacts.ts";
import type { UiCommandEmitter } from "../../sockets/sessionRoster.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import { pinArtifactSchema, unpinArtifactSchema } from "../internalSession.ts";
import { type SessionParams, sessionParamsSchema } from "./schemas.ts";
import { loadSession } from "./utils.ts";

const pinBodySchema = pinArtifactSchema.omit({ sessionId: true });
type PinBody = z.infer<typeof pinBodySchema>;

const unpinQuerySchema = unpinArtifactSchema.omit({ sessionId: true });
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
      const artifacts = await pinAndBroadcast(
        store,
        emitUiCommand,
        session.id,
        body,
      );
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
      await unpinAndBroadcast(store, emitUiCommand, session.id, query.path);
      res.status(204).end();
    },
  );
}
