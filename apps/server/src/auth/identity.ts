import type { IncomingHttpHeaders } from "node:http";

import type { UserIdentity } from "@tangent/shared/contracts.ts";

import {
  AUTH_JWT_TOKEN_COOKIE_NAME,
  AUTH_JWT_TOKEN_HEADER_NAME,
  EMBED_ALLOWED_ORIGINS,
  TRUSTED_IDENTITY_HEADER,
} from "../config.ts";
import { headerValue } from "./headers.ts";

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
 * `null` for any malformed token. The server never verifies: a token is
 * trusted for where it arrived from, and the backend is the only verifier.
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

/** Whether the payload's `exp` claim, when it has a usable one, has passed. */
function hasExpired(payload: Record<string, unknown>, now: number): boolean {
  const exp = payload.exp;
  return typeof exp === "number" && Number.isFinite(exp) && exp * 1000 <= now;
}

/**
 * Maps a decoded JWT (no signature check) onto a {@link UserIdentity}. A token
 * past its `exp` identifies nobody: it is read for where it arrived from, but
 * not for longer than its issuer meant it to be.
 */
function identityFromToken(token: string, now: number): UserIdentity | null {
  const payload = decodeJwtPayload(token);
  if (!payload || hasExpired(payload, now)) return null;
  const email = pickString(payload, ["email", "sub"]);
  if (!email) return null;

  return {
    email,
    first_name: pickString(payload, ["first_name", "given_name"]),
    last_name: pickString(payload, ["last_name", "family_name"]),
  };
}

/** Extracts the token from an `Authorization: Bearer <jwt>` header. */
function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec((header ?? "").trim());
  return match?.[1];
}

/** Where a request's identity came from, in order of precedence. */
export type IdentitySource =
  | "trusted-header"
  | "bearer"
  | "auth-header"
  | "cookie";

/** An identity together with the raw token it was read from. */
export interface ResolvedIdentity {
  identity: UserIdentity;
  token: string;
  source: IdentitySource;
}

/** The deployment settings that decide which identity sources are honoured. */
export interface IdentityConfig {
  trustedHeader: string;
  bearerAllowed: boolean;
  authHeader: string;
  cookieName: string;
}

const DEFAULT_CONFIG: IdentityConfig = {
  trustedHeader: TRUSTED_IDENTITY_HEADER,
  bearerAllowed: EMBED_ALLOWED_ORIGINS.length > 0,
  authHeader: AUTH_JWT_TOKEN_HEADER_NAME,
  cookieName: AUTH_JWT_TOKEN_COOKIE_NAME,
};

type SourceReader = (
  headers: IncomingHttpHeaders,
  config: IdentityConfig,
) => string | undefined;

/** Each source's token, in precedence order. */
const SOURCES: ReadonlyArray<[IdentitySource, SourceReader]> = [
  [
    "trusted-header",
    (headers, config) => headerValue(headers, config.trustedHeader),
  ],
  [
    "bearer",
    (headers, config) =>
      config.bearerAllowed ? bearerToken(headers.authorization) : undefined,
  ],
  ["auth-header", (headers, config) => headerValue(headers, config.authHeader)],
  [
    "cookie",
    (headers, config) =>
      config.cookieName
        ? parseCookies(headers.cookie)[config.cookieName]
        : undefined,
  ],
];

/** The first configured source that carries a token, highest precedence first. */
function presentedToken(
  headers: IncomingHttpHeaders,
  config: IdentityConfig,
): { token: string; source: IdentitySource } | null {
  for (const [source, read] of SOURCES) {
    const token = read(headers, config);
    if (token) return { token, source };
  }
  return null;
}

/**
 * Resolves who an incoming request is from, and from which source. The
 * precedence is a trust order: the trusted identity header, when configured,
 * is set by a front proxy that strips any client copy, so it wins outright; an
 * `Authorization: Bearer` token is honoured only when cross-origin embed hosts
 * are configured, because that is the one deployment where a client has to
 * carry its own token; then the forwarded auth header and the auth cookie.
 *
 * Every source is decoded without a signature check and mapped from the
 * `email` (or `sub`) and name claims. A token without an `email` claim uses
 * `sub` as the participant id, so an identity assertion issuer must put the
 * participant's email in `sub`; an opaque subject would be shown and compared
 * as if it were an email. Returns `null` when no configured source carries a
 * token, or the token it carries is malformed, anonymous or past its `exp`.
 */
export function resolveIdentity(
  headers: IncomingHttpHeaders,
  config: IdentityConfig = DEFAULT_CONFIG,
  now: number = Date.now(),
): ResolvedIdentity | null {
  const presented = presentedToken(headers, config);
  if (!presented) return null;
  const identity = identityFromToken(presented.token, now);
  if (!identity) return null;
  return { identity, ...presented };
}

/** The current {@link UserIdentity}, by the same precedence as {@link resolveIdentity}. */
export function resolveUserIdentity(
  headers: IncomingHttpHeaders,
  config: IdentityConfig = DEFAULT_CONFIG,
  now: number = Date.now(),
): UserIdentity | null {
  return resolveIdentity(headers, config, now)?.identity ?? null;
}
