import type {
  RemoteEnvTokenRequest,
  RemoteEnvTokenResponse,
} from "@tangent/shared/contracts.ts";

const REMOTE_ENV_TOKEN_PATH = "/api/embed/remote-env-token";

export interface ScopedEnvToken {
  token: string;
  environmentId: string;
  expiresAtMs?: number;
}

export interface MintRemoteEnvTokenParams {
  shellUrl: string;
  /**
   * Identity to mint as. When empty/omitted, no `Authorization` header is sent,
   * so the server derives identity from the request's cookie (the Oktasso SSO
   * cookie in prod) or the anonymous default (local dev).
   */
  email?: string;
  /** Routes this host to every session whose tags include it, e.g. `projectId:<id>`. */
  selector?: string;
  /** Binds the host to one session (a session-scoped token); wins over `selector`. */
  sessionId?: string;
  environmentId?: string;
  /** Test/transport seam; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/**
 * A JWT with `alg: "none"` and an empty signature. The Shell's embed mint
 * endpoint decodes the claims without verifying the signature, so this window
 * can present its identity without a server-issued credential.
 */
export function createUnsignedJwt(claims: Record<string, unknown>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify(claims));
  return `${header}.${payload}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isResponseBody(value: unknown): value is RemoteEnvTokenResponse {
  return (
    isRecord(value) &&
    typeof value.token === "string" &&
    value.token.length > 0 &&
    typeof value.environmentId === "string" &&
    value.environmentId.length > 0
  );
}

function parseExpiresAtMs(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** The mint request body: only the scope fields actually set are sent. */
function buildTokenRequest(
  params: MintRemoteEnvTokenParams,
): RemoteEnvTokenRequest {
  return {
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    ...(params.selector ? { selector: params.selector } : {}),
    ...(params.environmentId ? { environmentId: params.environmentId } : {}),
  };
}

/** The request headers, adding the unsigned-JWT identity only when `email` is set. */
function buildTokenHeaders(email: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (email) headers.Authorization = `Bearer ${createUnsignedJwt({ email })}`;
  return headers;
}

/**
 * Mints a scoped `/remote-env` token. Pass `email` to assert an identity via an
 * unsigned JWT, or omit it to let the server read the request's cookie (prod
 * Oktasso SSO) or fall back to the anonymous default (local dev). Pass
 * `sessionId` for a session-scoped token (bound to one session — what an attach
 * client uses) or `selector` for a selector-scoped host that reaches every
 * session whose tags include it; `sessionId` wins when both are set.
 * `environmentId` pins this host's place across refreshes; the server honors it
 * when free, so the response's id is authoritative.
 */
export async function mintRemoteEnvToken(
  params: MintRemoteEnvTokenParams,
): Promise<ScopedEnvToken> {
  const url = `${params.shellUrl.replace(/\/+$/, "")}${REMOTE_ENV_TOKEN_PATH}`;
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: buildTokenHeaders(params.email),
    body: JSON.stringify(buildTokenRequest(params)),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to mint remote-env token (${response.status} ${response.statusText}).`,
    );
  }
  const parsed: unknown = await response.json();
  if (!isResponseBody(parsed)) {
    throw new Error("Remote-env token response was malformed.");
  }
  const expiresAtMs = parseExpiresAtMs(parsed.expiresAt);
  return {
    token: parsed.token,
    environmentId: parsed.environmentId,
    ...(expiresAtMs ? { expiresAtMs } : {}),
  };
}
