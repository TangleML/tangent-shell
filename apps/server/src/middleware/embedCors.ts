import type { NextFunction, Request, RequestHandler, Response } from "express";

const ALLOWED_METHODS = "GET,POST,PATCH,PUT,DELETE,OPTIONS";
const ALLOWED_HEADERS = "Authorization, Content-Type";

/**
 * CORS for cross-origin embed hosts. Emits `Access-Control-*` headers only when
 * the request's `Origin` is in the allowlist — echoing the specific origin,
 * which is required because the embed sends an `Authorization` header — and
 * short-circuits preflight `OPTIONS`. With an empty allowlist it is a no-op, so
 * a same-origin deployment is unchanged.
 */
export function createEmbedCors(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
      res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}
