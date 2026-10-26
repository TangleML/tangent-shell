import {
  mintRemoteEnvToken,
  type MintRemoteEnvTokenParams,
} from "./remoteEnvToken.ts";

/** Renew this long before a token expires, and never sooner than the floor. */
const REFRESH_BUFFER_MS = 60_000;
const MIN_DELAY_MS = 30_000;

export interface TokenRefreshOptions {
  /** How to re-mint: scope, identity, and transport carried through each renew. */
  mintParams: MintRemoteEnvTokenParams;
  /** Swaps the freshly minted token into whatever holds the live connection. */
  applyToken: (token: string) => void | Promise<void>;
  log: (line: string) => void;
}

/**
 * Keeps a scoped token fresh by re-minting it before it expires and handing the
 * new token to {@link TokenRefreshOptions.applyToken}. The caller sets the
 * initial token; this only schedules the renewals. Returns a stop function.
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
      const minted = await mintRemoteEnvToken(options.mintParams);
      if (stopped) return;
      await options.applyToken(minted.token);
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
