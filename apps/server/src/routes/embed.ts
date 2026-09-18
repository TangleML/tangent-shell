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
  /** Reuse a pinned id across refresh so a host keeps its live socket. */
  environmentId: z.string().min(1).optional(),
});

/**
 * Decides which `environmentId` to mint: the caller's pinned id when it is free
 * (unclaimed, or already this person's), otherwise a fresh one so a mint can
 * never hijack another person's live host.
 */
type EnvironmentClaimedByOther = (
  environmentId: string,
  sub: string,
) => boolean;

/** True when `email` holds a Membership in `sessionId` — the same gate chat uses. */
type SessionMemberCheck = (
  sessionId: string,
  email: string,
) => Promise<boolean>;

/** True when `email` owns `session`: its creator, or any human when auth is off. */
function isSessionOwner(session: Session, email: string): boolean {
  const owner = session.user?.email;
  if (!owner) return true;
  return owner === email;
}

/** Whether `email` may mint for `session`: its owner, or a Membership holder. */
async function canMintForSession(
  session: Session,
  email: string,
  isSessionMember: SessionMemberCheck,
): Promise<boolean> {
  if (isSessionOwner(session, email)) return true;
  return isSessionMember(session.id, email);
}

/** The authenticated, authorized caller a mint runs for. */
interface MintCaller {
  session: Session;
  email: string;
}

/** A refused mint: the status and message to send. */
interface MintDenied {
  status: number;
  error: string;
}

/**
 * Resolves and authorizes the caller: a valid identity, a known session, and
 * owner-or-member access. Returns the caller on success, or the response to send
 * on refusal, so the handler stays a flat sequence of guards.
 */
async function authorizeMint(
  store: SessionStore,
  req: Request,
  isSessionMember: SessionMemberCheck,
): Promise<MintCaller | MintDenied> {
  const identity = resolveUserIdentity(
    req.headers.cookie,
    req.headers.authorization,
  );
  if (!identity) return { status: 401, error: "Invalid or missing token" };

  const { sessionId } = getValidated<RemoteEnvTokenRequest>(req).body;
  const session = await store.getSession(sessionId);
  if (!session) return { status: 404, error: "Session not found" };

  if (!(await canMintForSession(session, identity.email, isSessionMember))) {
    return { status: 403, error: "Forbidden" };
  }
  return { session, email: identity.email };
}

/** The id to mint: the caller's pinned id when free, else a fresh one. */
function resolveEnvironmentId(
  requestedId: string | undefined,
  sub: string,
  isEnvironmentClaimedByOther: EnvironmentClaimedByOther,
): string {
  if (requestedId && !isEnvironmentClaimedByOther(requestedId, sub)) {
    return requestedId;
  }
  return randomUUID();
}

/**
 * Mints a scoped `/remote-env` token for an embed host. Authed by the embed JWT
 * (bearer) or the Oktasso cookie; the token binds `sessionId` and the caller's
 * email (`sub`) to an `environmentId` — a pinned one when supplied and free,
 * else a fresh one. The caller must own the session or hold a Membership in it,
 * the same gate chat enforces, so a session id alone is not enough to host tools.
 */
export async function handleMintRemoteEnvToken(
  store: SessionStore,
  scoped: ScopedTokenCredential,
  req: Request,
  res: Response,
  isEnvironmentClaimedByOther: EnvironmentClaimedByOther = () => false,
  isSessionMember: SessionMemberCheck = () => Promise.resolve(false),
): Promise<void> {
  const caller = await authorizeMint(store, req, isSessionMember);
  if ("error" in caller) {
    res.status(caller.status).json({ error: caller.error });
    return;
  }

  if (!scoped.configured) {
    res
      .status(503)
      .json({ error: "Remote environment tokens are not configured" });
    return;
  }

  const { environmentId: requestedId } =
    getValidated<RemoteEnvTokenRequest>(req).body;
  const environmentId = resolveEnvironmentId(
    requestedId,
    caller.email,
    isEnvironmentClaimedByOther,
  );
  const minted = scoped.mint({
    environmentId,
    sessionId: caller.session.id,
    sub: caller.email,
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
  isEnvironmentClaimedByOther: EnvironmentClaimedByOther = () => false,
  isSessionMember: SessionMemberCheck = () => Promise.resolve(false),
  scoped: ScopedTokenCredential = scopedRemoteEnvCredential,
): Router {
  const router = Router();
  router.post(
    "/remote-env-token",
    validate({ body: remoteEnvTokenBodySchema }),
    (req: Request, res: Response) =>
      void handleMintRemoteEnvToken(
        store,
        scoped,
        req,
        res,
        isEnvironmentClaimedByOther,
        isSessionMember,
      ),
  );
  return router;
}
