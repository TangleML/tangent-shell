/**
 * Proxy mount-prefix awareness, plus a runtime override for embedded mode.
 *
 * Behind the tangle pod-proxy the app is served from a sub-path
 * (e.g. `.../ports/8000/`), not the origin root. `index.html` injects a
 * `<base href>` pointing at that mount root, so `document.baseURI` reflects it.
 * `BASE_PREFIX` captures that prefix once at boot and `apiUrl` rewrites
 * origin-root paths (e.g. `/api/...`, `/socket.io`) onto it.
 *
 * At the origin root (dev, production-without-proxy) the prefix is `/` and
 * `apiUrl` is a no-op aside from normalizing the leading slash.
 *
 * When the code runs embedded on a third-party host page, `document.baseURI`
 * is the *host's* URL and there is no Vite proxy, so API traffic must target
 * Tangent's origin directly. `configureEmbedApi` lets the embed runtime supply
 * an absolute API base, an explicit Socket.IO url/path, and a bearer-token
 * getter. All accessors below fall back to the same-origin behaviour when it is
 * left unset, so the standalone SPA is unchanged.
 */

/** The mount-root pathname, always ending in `/` (e.g. `.../ports/8000/` or `/`). */
export const BASE_PREFIX = new URL(document.baseURI).pathname;

export interface EmbedApiConfig {
  /** Absolute API origin (optionally with a mount prefix), e.g. `https://tangent.example/`. */
  apiBase?: string;
  /** Absolute origin for the Socket.IO connection. Defaults to same-origin. */
  socketUrl?: string;
  /** Socket.IO path. Defaults to `${BASE_PREFIX}socket.io`. */
  socketPath?: string;
  /** Returns a bearer token for API/socket auth. May be sync or async. */
  getToken?: () => string | undefined | Promise<string | undefined>;
}

let embedConfig: EmbedApiConfig = {};

/** Sets (merges) the embedded-mode API configuration. */
export function configureEmbedApi(config: EmbedApiConfig): void {
  embedConfig = { ...embedConfig, ...config };
}

/** Rewrites an origin-root path onto the embed API base, or the mount prefix. */
export function apiUrl(path: string): string {
  const rel = path.replace(/^\//, "");
  if (embedConfig.apiBase) {
    return `${embedConfig.apiBase.replace(/\/$/, "")}/${rel}`;
  }
  return `${BASE_PREFIX}${rel}`;
}

/**
 * The origin to pass to `io()`; `undefined` means same-origin. Embedded on a
 * host page, defaults to the API base's origin so the socket targets Tangent's
 * origin rather than the host page. The standalone SPA has no `apiBase`, so it
 * stays same-origin (Vite proxies `/socket.io` in dev).
 */
export function socketUrl(): string | undefined {
  if (embedConfig.socketUrl) return embedConfig.socketUrl;
  if (embedConfig.apiBase) return new URL(embedConfig.apiBase).origin;
  return undefined;
}

/** The Socket.IO path, mount-prefix aware unless overridden for embed. */
export function socketPath(): string {
  return embedConfig.socketPath ?? `${BASE_PREFIX}socket.io`;
}

/** Resolves the current bearer token, if a getter was configured. */
export function getAuthToken():
  | string
  | undefined
  | Promise<string | undefined> {
  return embedConfig.getToken?.();
}
