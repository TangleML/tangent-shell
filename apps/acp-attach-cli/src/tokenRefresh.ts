import type { AttachClient } from "@tangent/acp-attach-host/attachClient.ts";
import {
  mintRemoteEnvToken,
  type MintRemoteEnvTokenParams,
} from "@tangent/local-agent-host/remoteEnvToken.ts";

/** Renew this long before a token expires, and never sooner than the floor. */
const REFRESH_BUFFER_MS = 60_000;
const MIN_DELAY_MS = 30_000;

export interface TokenRefreshOptions {
  shellUrl: string;
  sessionId: string;
  /** Identity to re-mint with; omit to rely on the cookie/anonymous identity. */
  email?: string;
  client: AttachClient;
  /** Transport seam (e.g. the Oktasso-aware fetch); defaults to global fetch. */
  fetchImpl?: typeof fetch;
  log: (line: string) => void;
}

/** The re-mint params, carrying the optional identity and transport through. */
function mintParams(options: TokenRefreshOptions): MintRemoteEnvTokenParams {
  return {
    shellUrl: options.shellUrl,
    sessionId: options.sessionId,
    ...(options.email ? { email: options.email } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  };
}

/**
 * Keeps the attach client's session-scoped token fresh by re-minting it before
 * it expires, swapping it in with {@link AttachClient.setToken}. The caller sets
 * the initial token; this only schedules the renewals. Returns a stop function.
 */
export function startTokenRefresh(
  options: TokenRefreshOptions,
  expiresAtMs?: number,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function schedule(at?: number): void {
    const delay = at
      ? Math.max(at - Date.now() - REFRESH_BUFFER_MS, MIN_DELAY_MS)
      : MIN_DELAY_MS;
    timer = setTimeout(() => void renew(), delay);
  }

  async function renew(): Promise<void> {
    try {
      const minted = await mintRemoteEnvToken(mintParams(options));
      if (stopped) return;
      options.client.setToken(minted.token);
      schedule(minted.expiresAtMs);
    } catch (err) {
      if (stopped) return;
      const message = err instanceof Error ? err.message : String(err);
      options.log(`token refresh failed: ${message}`);
      schedule();
    }
  }

  schedule(expiresAtMs);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
