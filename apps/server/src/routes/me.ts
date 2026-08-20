import { type Request, type Response, Router } from "express";

import { resolveUserIdentity } from "../auth/identity.ts";

/**
 * Handles `GET /api/me`. Resolves the current user from an
 * `Authorization: Bearer` JWT (the embed passes one cross-origin) or the
 * Oktasso JWT in the configured cookie and returns the full identity. `user_id`
 * is kept (set to the email) for backward compatibility alongside the
 * structured `email` / `first_name` / `last_name` fields.
 */
function handleGetMe(req: Request, res: Response): void {
  const identity = resolveUserIdentity(
    req.headers.cookie,
    req.headers.authorization,
  );
  if (!identity) {
    res.status(401).json({ error: "Invalid or missing token" });
    return;
  }

  res.json({ user_id: identity.email, ...identity });
}

/**
 * Public REST router exposing the current user, derived from the Oktasso JWT in
 * the `OKTASSO_TOKEN` cookie. The signature is not verified at this time.
 */
export function createMeRouter(): Router {
  const router = Router();
  router.get("/", (req: Request, res: Response) => handleGetMe(req, res));
  return router;
}
