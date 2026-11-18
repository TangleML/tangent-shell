import type { IncomingHttpHeaders } from "node:http";

import type { UserIdentity } from "@tangent/shared/contracts.ts";

import {
  AUTH_JWT_TOKEN_COOKIE_NAME,
  AUTH_JWT_TOKEN_HEADER_NAME,
} from "../config.ts";

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

/** The JWT in the {@link AUTH_JWT_TOKEN_HEADER_NAME} header, if configured and sent. */
function headerToken(headers: IncomingHttpHeaders): string | undefined {
  if (!AUTH_JWT_TOKEN_HEADER_NAME) return undefined;
  const value = headers[AUTH_JWT_TOKEN_HEADER_NAME];
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

/**
 * Resolves the current {@link UserIdentity} from an incoming request's
 * credentials. Prefers an `Authorization: Bearer` JWT (the embed passes one
 * cross-origin, where cookies are unavailable), then the JWT in the
 * {@link AUTH_JWT_TOKEN_HEADER_NAME} header (for proxies that drop cookies),
 * then the Oktasso JWT in {@link AUTH_JWT_TOKEN_COOKIE_NAME}. The payload is
 * decoded without a signature check and mapped from the email + name claims.
 *
 * Returns `null` when no token resolves, the token is malformed, or it carries
 * no email. The header and cookie paths each require their name to be
 * configured; the bearer path does not. Name claims fall back across the OIDC
 * standard (`given_name` / `family_name`) and snake-case (`first_name` /
 * `last_name`) variants, defaulting to `""` when absent.
 */
export function resolveUserIdentity(
  headers: IncomingHttpHeaders,
): UserIdentity | null {
  const bearer = bearerToken(headers.authorization);
  if (bearer) return identityFromToken(bearer);

  const forwarded = headerToken(headers);
  if (forwarded) return identityFromToken(forwarded);

  if (!AUTH_JWT_TOKEN_COOKIE_NAME) return null;
  return identityFromToken(
    parseCookies(headers.cookie)[AUTH_JWT_TOKEN_COOKIE_NAME],
  );
}
