import { randomUUID } from "node:crypto";

import type {
  RemoteEnvTokenRequest,
  RemoteEnvTokenResponse,
  Session,
} from "@tangent/shared/contracts.ts";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { resolveUserIdentity } from "../auth/identity.ts";
import {
  scopedRemoteEnvCredential,
  type ScopedTokenCredential,
} from "../connectors/credentials.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import type { SessionStore } from "../store/sessionStore.ts";

const remoteEnvTokenBodySchema = z.object({
  sessionId: z.string().min(1),
});

/** True when `email` may mint a token for `session`. */
function canMintForSession(session: Session, email: string): boolean {
  const owner = session.user?.email;
  if (!owner) return true;
  return owner === email;
}

/**
 * Mints a scoped `/remote-env` token for an embed host. Authed by the embed JWT
 * (bearer) or the Oktasso cookie; the token is bound to `sessionId` and a
 * freshly generated `environmentId`.
 */
export async function handleMintRemoteEnvToken(
  store: SessionStore,
  scoped: ScopedTokenCredential,
  req: Request,
  res: Response,
): Promise<void> {
  const identity = resolveUserIdentity(
    req.headers.cookie,
    req.headers.authorization,
  );
  if (!identity) {
    res.status(401).json({ error: "Invalid or missing token" });
    return;
  }

  const { sessionId } = getValidated<RemoteEnvTokenRequest>(req).body;
  const session = await store.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (!canMintForSession(session, identity.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!scoped.configured) {
    res
      .status(503)
      .json({ error: "Remote environment tokens are not configured" });
    return;
  }

  const environmentId = randomUUID();
  const minted = scoped.mint({
    environmentId,
    sessionId,
    sub: identity.email,
  });
  const body: RemoteEnvTokenResponse = {
    token: minted.token,
    environmentId,
    expiresAt: minted.expiresAt,
  };
  res.json(body);
}

/** Public embed routes (`POST /remote-env-token`). */
export function createEmbedRouter(
  store: SessionStore,
  scoped: ScopedTokenCredential = scopedRemoteEnvCredential,
): Router {
  const router = Router();
  router.post(
    "/remote-env-token",
    validate({ body: remoteEnvTokenBodySchema }),
    (req: Request, res: Response) =>
      void handleMintRemoteEnvToken(store, scoped, req, res),
  );
  return router;
}
