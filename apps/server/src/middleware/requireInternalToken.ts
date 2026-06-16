import type { NextFunction, Request, Response } from "express";

import { INTERNAL_TOKEN } from "../config.ts";

/**
 * Shared guard for the `/internal/*` APIs: rejects any request not bearing the
 * server's internal bearer token. The token is shared with the Pi processes via
 * env, so arbitrary local callers can't drive a session's agents/triggers/memory.
 */
export function requireInternalToken(
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
