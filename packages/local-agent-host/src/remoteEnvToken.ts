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
  /** Routes this host to every session whose tags include it, e.g. `projectId:<id>`. */
  selector: string;
  email: string;
  environmentId?: string;
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

/**
 * Mints a selector-scoped `/remote-env` token as `email`. The server routes a
 * session's spawns and tool calls to the prompting person's scoped hosts, so
 * this host reaches every session whose tags include `selector` — but only when
 * the token's `sub` matches the prompting person. `environmentId` pins this
 * host's place across refreshes; the server honors it when free, so the
 * response's id is authoritative.
 */
export async function mintRemoteEnvToken({
  shellUrl,
  selector,
  email,
  environmentId,
}: MintRemoteEnvTokenParams): Promise<ScopedEnvToken> {
  const url = `${shellUrl.replace(/\/+$/, "")}${REMOTE_ENV_TOKEN_PATH}`;
  const body: RemoteEnvTokenRequest = {
    selector,
    ...(environmentId ? { environmentId } : {}),
  };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${createUnsignedJwt({ email })}`,
    },
    body: JSON.stringify(body),
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
