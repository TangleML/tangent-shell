import type { UserIdentity } from "@tangent/shared/contracts.ts";

import { AUTH_JWT_TOKEN_COOKIE_NAME } from "../config.ts";

/** Parses a raw `Cookie` header into a name->value map. */
export function parseCookies(
  header: string | undefined,
): Record<string, string> {
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
export function decodeJwtPayload(
  token: string,
): Record<string, unknown> | null {
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

/** Returns the first string-valued claim among `keys`, or `""` if none match. */
function pickString(
  payload: Record<string, unknown>,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

/** Maps a decoded JWT (no signature check) onto a {@link UserIdentity}. */
function identityFromToken(token: string | undefined): UserIdentity | null {
  if (!token) return null;

  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.email !== "string" || !payload.email) {
    return null;
  }

  return {
    email: payload.email,
    first_name: pickString(payload, ["first_name", "given_name"]),
    last_name: pickString(payload, ["last_name", "family_name"]),
  };
}

/** Extracts the token from an `Authorization: Bearer <jwt>` header. */
function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec((header ?? "").trim());
  return match?.[1];
}

/**
 * Resolves the current {@link UserIdentity} from an incoming request's
 * credentials. Prefers an `Authorization: Bearer` JWT (the embed passes one
 * cross-origin, where cookies are unavailable) and falls back to the Oktasso
 * JWT in {@link AUTH_JWT_TOKEN_COOKIE_NAME}. The payload is decoded without a
 * signature check and mapped from the email + name claims.
 *
 * Returns `null` when no token resolves, the token is malformed, or it carries
 * no email. The cookie path additionally requires the cookie name to be
 * configured; the bearer path does not. Name claims fall back across the OIDC
 * standard (`given_name` / `family_name`) and snake-case (`first_name` /
 * `last_name`) variants, defaulting to `""` when absent.
 */
export function resolveUserIdentity(
  cookieHeader: string | undefined,
  authorizationHeader?: string | undefined,
): UserIdentity | null {
  const bearer = bearerToken(authorizationHeader);
  if (bearer) return identityFromToken(bearer);

  if (!AUTH_JWT_TOKEN_COOKIE_NAME) return null;
  return identityFromToken(
    parseCookies(cookieHeader)[AUTH_JWT_TOKEN_COOKIE_NAME],
  );
}
