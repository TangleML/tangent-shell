import { type Request, type Response, Router } from "express";

import { AUTH_JWT_TOKEN_COOKIE_NAME } from "../config.ts";

/** Parses a raw `Cookie` header into a name->value map. */
function parseCookies(header: string | undefined): Record<string, string> {
  return Object.fromEntries(
    (header ?? "")
      .split(";")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const idx = pair.indexOf("=");
        return idx === -1
          ? [pair, ""]
          : [pair.slice(0, idx), pair.slice(idx + 1)];
      }),
  );
}

/**
 * Decodes a JWT's payload segment WITHOUT verifying its signature. Returns
 * `null` for any malformed token. Signature verification is intentionally
 * skipped for now.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segment = token.split(".")[1];
  if (!segment) return null;
  try {
    const json = Buffer.from(segment, "base64url").toString("utf8");
    const payload = JSON.parse(json) as unknown;
    if (typeof payload !== "object" || payload === null) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Handles `GET /api/me`. Reads the JWT from the configured Minerva cookie
 * ({@link AUTH_JWT_TOKEN_COOKIE_NAME}), decodes its payload (no signature check),
 * and returns the user's email as `user_id`.
 */
function handleGetMe(req: Request, res: Response): void {
  if (!AUTH_JWT_TOKEN_COOKIE_NAME) {
    res.status(501).json({ error: "Minerva cookie name not configured" });
    return;
  }

  const token = parseCookies(req.headers.cookie)[AUTH_JWT_TOKEN_COOKIE_NAME];
  if (!token) {
    res
      .status(401)
      .json({ error: `Missing ${AUTH_JWT_TOKEN_COOKIE_NAME} cookie` });
    return;
  }

  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.email !== "string") {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  res.json({ user_id: payload.email });
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
