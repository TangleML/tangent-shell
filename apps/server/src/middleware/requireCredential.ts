import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { ConnectorCredential } from "../connectors/credentials.ts";

/**
 * Guards a router with one connector's credential. The comparison lives in the
 * credential, so a route says which far end it is for rather than knowing what
 * that far end presents — which is what keeps a new connector from having to
 * edit a shared auth path.
 */
export function requireCredential(
  credential: ConnectorCredential,
): RequestHandler {
  return function guard(req: Request, res: Response, next: NextFunction): void {
    if (!credential.verify({ authorization: req.get("authorization") })) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}
