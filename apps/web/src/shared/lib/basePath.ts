/**
 * Proxy mount-prefix awareness.
 *
 * Behind the tangle pod-proxy the app is served from a sub-path
 * (e.g. `.../ports/8000/`), not the origin root. `index.html` injects a
 * `<base href>` pointing at that mount root, so `document.baseURI` reflects it.
 * `BASE_PREFIX` captures that prefix once at boot and `apiUrl` rewrites
 * origin-root paths (e.g. `/api/...`, `/socket.io`) onto it.
 *
 * At the origin root (dev, production-without-proxy) the prefix is `/` and
 * `apiUrl` is a no-op aside from normalizing the leading slash.
 */

/** The mount-root pathname, always ending in `/` (e.g. `.../ports/8000/` or `/`). */
export const BASE_PREFIX = new URL(document.baseURI).pathname;

/** Rewrites an origin-root path onto the mount prefix. */
export function apiUrl(path: string): string {
  return `${BASE_PREFIX}${path.replace(/^\//, "")}`;
}
