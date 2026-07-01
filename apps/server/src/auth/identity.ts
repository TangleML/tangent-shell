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

/**
 * Resolves the current {@link UserIdentity} from a raw `Cookie` header. Reads
 * the Oktasso JWT from {@link AUTH_JWT_TOKEN_COOKIE_NAME}, decodes its payload
 * (no signature check), and maps the email + name claims onto the identity.
 *
 * Returns `null` when the cookie name is unconfigured, the cookie is missing,
 * the token is malformed, or it carries no email. Name claims fall back across
 * the OIDC standard (`given_name` / `family_name`) and snake-case
 * (`first_name` / `last_name`) variants, defaulting to `""` when absent.
 */
export function resolveUserIdentity(
  cookieHeader: string | undefined,
): UserIdentity | null {
  if (!AUTH_JWT_TOKEN_COOKIE_NAME) return null;

  const token = parseCookies(cookieHeader)[AUTH_JWT_TOKEN_COOKIE_NAME];
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
