import { type Request, type Response, Router } from "express";

import { resolveUserIdentity } from "../auth/identity.ts";
import { AUTH_JWT_TOKEN_COOKIE_NAME } from "../config.ts";

/**
 * Handles `GET /api/me`. Resolves the current user from the Minerva JWT in the
 * configured cookie ({@link AUTH_JWT_TOKEN_COOKIE_NAME}) and returns the full
 * identity. `user_id` is kept (set to the email) for backward compatibility
 * alongside the structured `email` / `first_name` / `last_name` fields.
 */
function handleGetMe(req: Request, res: Response): void {
  if (!AUTH_JWT_TOKEN_COOKIE_NAME) {
    res.status(501).json({ error: "Minerva cookie name not configured" });
    return;
  }

  const identity = resolveUserIdentity(req.headers.cookie);
  if (!identity) {
    res.status(401).json({ error: "Invalid or missing token" });
    return;
  }

  res.json({ user_id: identity.email, ...identity });
}

/**
 * Public REST router exposing the current user, derived from the Minerva JWT in
 * the `MINERVA_TOKEN` cookie. The signature is not verified at this time.
 */
export function createMeRouter(): Router {
  const router = Router();
  router.get("/", (req: Request, res: Response) => handleGetMe(req, res));
  return router;
}
