import type { NextFunction, Request, RequestHandler, Response } from "express";

import {
  canEditBundles,
  gateEnabled,
  isAdmin,
  requestEmail,
} from "../auth/permissions.ts";
import { ADMIN_EMAILS } from "../config.ts";
import type { BundleEditorStore } from "../store/bundleEditorStore.ts";

const SIGN_IN_REQUIRED = "Sign in required";

/**
 * Answers `401`/`403` and returns `true` when the gate is on and the caller
 * isn't an admin. For routes whose gating depends on the request body or query,
 * where a static middleware can't decide.
 */
export function rejectNonAdmin(
  req: Request,
  res: Response,
  admins: ReadonlySet<string> = ADMIN_EMAILS,
): boolean {
  if (!gateEnabled(admins)) return false;
  const email = requestEmail(req);
  if (!email) {
    res.status(401).json({ error: SIGN_IN_REQUIRED });
    return true;
  }
  if (!isAdmin(email, admins)) {
    res.status(403).json({ error: "Admin access required" });
    return true;
  }
  return false;
}

/** Guards a route so only admins reach it. */
export function requireAdmin(
  admins: ReadonlySet<string> = ADMIN_EMAILS,
): RequestHandler {
  return function guard(req: Request, res: Response, next: NextFunction): void {
    if (rejectNonAdmin(req, res, admins)) return;
    next();
  };
}

/** Guards a route so only admins and listed bundle editors reach it. */
export function requireBundleEditor(
  editors: BundleEditorStore,
  admins: ReadonlySet<string> = ADMIN_EMAILS,
): RequestHandler {
  return async function guard(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!gateEnabled(admins)) {
      next();
      return;
    }
    const email = requestEmail(req);
    if (!email) {
      res.status(401).json({ error: SIGN_IN_REQUIRED });
      return;
    }
    if (!(await canEditBundles(email, editors, admins))) {
      res
        .status(403)
        .json({ error: "Only bundle editors can upload or delete bundles" });
      return;
    }
    next();
  };
}
