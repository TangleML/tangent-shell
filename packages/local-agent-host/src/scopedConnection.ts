import { mintRemoteEnvToken } from "./remoteEnvToken.ts";

/** Refresh this long before a token expires, and never sooner than the floor. */
const TOKEN_REFRESH_BUFFER_MS = 30_000;
const MIN_RETRY_MS = 5_000;
const MAX_RETRY_MS = 30_000;

export interface ScopedConnectionOptions {
  shellUrl: string;
  /** Routes this host to every session tagged with it, e.g. `projectId:<id>`. */
  selector: string;
  email: string;
  initialEnvironmentId?: string;
  connect(token: string, environmentId: string): void;
  onError(message: string): void;
  /** Test seam; defaults to the live mint endpoint. */
  mint?: typeof mintRemoteEnvToken;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error.";
}

/**
 * Keeps a selector-scoped host connected with a self-renewing token: mints a
 * token, calls {@link ScopedConnectionOptions.connect}, and schedules a refresh
 * before it expires. The environment id is pinned across refreshes so the server
 * keeps routing the project's spawns to the same host. Returns a stop function
 * that cancels the loop; the caller still owns tearing down the connection.
 */
export function startScopedConnection(
  options: ScopedConnectionOptions,
): () => void {
  const mint = options.mint ?? mintRemoteEnvToken;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let environmentId = options.initialEnvironmentId;
  let retryMs = MIN_RETRY_MS;

  function schedule(delay: number): void {
    timer = setTimeout(() => void connectOnce(), delay);
  }

  async function connectOnce(): Promise<void> {
    try {
      const token = await mint({
        shellUrl: options.shellUrl,
        selector: options.selector,
        email: options.email,
        ...(environmentId ? { environmentId } : {}),
      });
      if (cancelled) return;
      environmentId = token.environmentId;
      options.connect(token.token, token.environmentId);
      retryMs = MIN_RETRY_MS;
      if (token.expiresAtMs) {
        const delay = Math.max(
          token.expiresAtMs - Date.now() - TOKEN_REFRESH_BUFFER_MS,
          MIN_RETRY_MS,
        );
        schedule(delay);
      }
    } catch (error) {
      if (cancelled) return;
      options.onError(errorMessage(error));
      schedule(retryMs);
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    }
  }

  void connectOnce();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
