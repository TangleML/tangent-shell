import { getOktassoCookie, peekOktassoCookie } from "./oktasso.ts";

/**
 * Wraps `fetch` so requests to an Okta-protected Shell authenticate themselves.
 * A cached cookie (this client's or `tangle_deploy`'s) rides on every request;
 * when the Shell still answers as proxy-blocked, it runs the Oktasso login once,
 * caches the cookie, and retries. Unprotected (local dev) Shells never trigger
 * the flow, so the wrapper is a transparent pass-through there.
 *
 * @param shellOrigin The Shell origin, used as the token audience and cache key.
 */
export function createOktassoFetch(
  shellOrigin: string,
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  let cookie: string | null = null;
  let peeked = false;
  let authInFlight: Promise<string> | null = null;

  async function currentCookie(): Promise<string | null> {
    if (cookie || peeked) return cookie;
    peeked = true;
    cookie = await peekOktassoCookie(shellOrigin).catch(() => null);
    return cookie;
  }

  /** Runs the login once even under concurrent blocked requests. */
  async function authenticate(): Promise<string> {
    if (!authInFlight) {
      authInFlight = getOktassoCookie(shellOrigin).finally(() => {
        authInFlight = null;
      });
    }
    cookie = await authInFlight;
    return cookie;
  }

  const wrapped: typeof fetch = async (input, init) => {
    const withCookie = await currentCookie();
    const first = await baseFetch(input, withHeaders(init, withCookie));
    if (!looksProxyBlocked(first, shellOrigin)) return first;

    const fresh = await authenticate();
    return baseFetch(input, withHeaders(init, fresh));
  };
  return wrapped;
}

/** Clones `init`, merging the Oktasso cookie into its headers when present. */
function withHeaders(
  init: RequestInit | undefined,
  cookie: string | null,
): RequestInit {
  const next: RequestInit = { ...init, redirect: "manual" };
  if (!cookie) return next;
  const headers = new Headers(init?.headers);
  headers.set("cookie", cookie);
  next.headers = headers;
  return next;
}

/**
 * Whether a response reads as an SSO proxy refusing an unauthenticated request:
 * an off-origin redirect to the identity provider, or an HTML login page served
 * where the API should answer JSON. A 401/403 only counts when it is *not* a
 * JSON body — the proxy serves HTML or redirects, whereas the Shell's own API
 * answers a genuine auth failure with JSON. Treating that JSON 401 as a proxy
 * block would silently reopen the browser instead of surfacing the real error.
 */
function looksProxyBlocked(res: Response, shellOrigin: string): boolean {
  if (isOffOriginRedirect(res, shellOrigin)) return true;
  if (res.status === 401 || res.status === 403) return !servesJson(res);
  return servesHtml(res);
}

function isOffOriginRedirect(res: Response, shellOrigin: string): boolean {
  if (res.status < 300 || res.status >= 400) return false;
  const location = res.headers.get("location");
  return !location || originOf(location) !== shellOrigin;
}

function servesHtml(res: Response): boolean {
  return (res.headers.get("content-type") ?? "").includes("text/html");
}

function servesJson(res: Response): boolean {
  return (res.headers.get("content-type") ?? "").includes("application/json");
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
