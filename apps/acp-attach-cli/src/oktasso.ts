/**
 * Self-contained Oktasso SSO via Okta PKCE, bundled into the attach client so
 * it can authenticate against an Okta-protected Shell without the repo's
 * `scripts/` tooling.
 *
 * Ported from `scripts/oktassoAuth.ts`, with two differences: config is read
 * from the environment (no `.env`/`env.ts` dependency), and the public surface
 * is a single {@link getOktassoCookie}. Deployment-specific values (provider
 * endpoints, client id, cookie name) have no defaults and must be supplied via
 * the environment; only generic OAuth settings fall back to local-dev defaults.
 * The on-disk cache shape matches the Python `rowlet` client and
 * `scripts/oktassoAuth.ts`, so all three share the file.
 */

import crypto from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

/** Non-secret Oktasso config, read from the environment. */
interface OktassoConfig {
  oauthEndpointBase: string;
  tokenExchangeUrl: string;
  clientId: string;
  scopes: string;
  redirectUri: string;
  callbackPort: number;
  refreshAfterMs: number;
  cookieName: string;
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

/** A required env var with no default — deployment-specific, never baked in. */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value && value.length > 0) return value;
  throw new Error(
    `Oktasso auth: missing required config ${name}. Set the OKTASSO_* and ` +
      `AUTH_JWT_TOKEN_COOKIE_NAME variables for your deployment (see .env.example).`,
  );
}

function readConfig(): OktassoConfig {
  return {
    oauthEndpointBase: requiredEnv("OKTASSO_OAUTH_ENDPOINT_BASE"),
    tokenExchangeUrl: requiredEnv("OKTASSO_TOKEN_EXCHANGE_URL"),
    clientId: requiredEnv("OKTASSO_CLIENT_ID"),
    scopes: env("OKTASSO_SCOPES", "profile email openid"),
    redirectUri: env("OKTASSO_REDIRECT_URI", "http://localhost:3001/auth"),
    callbackPort: Number(env("OKTASSO_CALLBACK_PORT", "3001")),
    refreshAfterMs: Number(env("OKTASSO_REFRESH_AFTER_MS", "3300000")),
    cookieName: requiredEnv("AUTH_JWT_TOKEN_COOKIE_NAME"),
  };
}

const CACHE_DIR = path.join(os.homedir(), ".cache", "tangle-deploy");
const CACHE_FILE = path.join(CACHE_DIR, "oktasso_token.json");

interface CachedTokenPayload {
  headers: { cookie: string };
  base_url: string;
  created_at: number; // seconds since epoch, matching Python's time.time()
}

function log(line: string): void {
  console.error(`[oktasso] ${line}`);
}

/**
 * Returns a `NAME=token` cookie string authenticating requests to `baseUrl`,
 * reusing the on-disk cache when fresh for the same base URL, otherwise running
 * the full PKCE browser flow and caching the result.
 */
export async function getOktassoCookie(baseUrl: string): Promise<string> {
  const config = readConfig();

  const cached = await loadCachedCookie(baseUrl, config.refreshAfterMs);
  if (cached) return cached;

  const cookie = await runAuthFlow(config, baseUrl);
  await saveCachedCookie(cookie, baseUrl);
  return cookie;
}

/**
 * Returns a cached, still-fresh cookie for `baseUrl` without ever opening a
 * browser — used to attach a prior login (this client's or `tangle_deploy`'s)
 * from the first request. `null` when nothing usable is cached.
 */
export function peekOktassoCookie(baseUrl: string): Promise<string | null> {
  return loadCachedCookie(baseUrl, refreshAfterMs());
}

/** The generic cache lifetime, readable without the deployment-specific config. */
function refreshAfterMs(): number {
  return Number(env("OKTASSO_REFRESH_AFTER_MS", "3300000"));
}

async function loadCachedCookie(
  baseUrl: string,
  refreshAfterMs: number,
): Promise<string | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    const payload = JSON.parse(raw) as CachedTokenPayload;
    if (payload.base_url !== baseUrl) return null;
    if (!payload.headers?.cookie) return null;
    const ageMs = Date.now() - payload.created_at * 1000;
    if (ageMs >= refreshAfterMs) return null;
    return payload.headers.cookie;
  } catch {
    return null;
  }
}

async function saveCachedCookie(
  cookie: string,
  baseUrl: string,
): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true, mode: 0o700 });
    const payload: CachedTokenPayload = {
      headers: { cookie },
      base_url: baseUrl,
      created_at: Date.now() / 1000,
    };
    await writeFile(CACHE_FILE, JSON.stringify(payload), { mode: 0o600 });
    await chmod(CACHE_FILE, 0o600);
  } catch (err) {
    log(`warning: could not cache Oktasso token: ${stringifyError(err)}`);
  }
}

async function runAuthFlow(
  config: OktassoConfig,
  audienceUrl: string,
): Promise<string> {
  const { verifier, challenge } = generatePkcePair();
  const code = await getAuthorizationCode(config, challenge);
  const accessToken = await exchangeCodeForAccessToken(config, code, verifier);
  const oktassoToken = await exchangeAccessTokenForOktassoToken(
    config,
    accessToken,
    audienceUrl,
  );
  return `${config.cookieName}=${oktassoToken}`;
}

function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64UrlNoPad(crypto.randomBytes(64));
  const challenge = base64UrlNoPad(
    crypto.createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge };
}

function base64UrlNoPad(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getAuthorizationCode(
  config: OktassoConfig,
  challenge: string,
): Promise<string> {
  const codePromise = waitForAuthorizationCode(config.callbackPort);

  const url = new URL("authorize", config.oauthEndpointBase);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("callback_url", config.redirectUri);
  url.searchParams.set("scope", config.scopes);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", "1234");
  url.searchParams.set("redirect_uri", config.redirectUri);

  log("opening browser for Oktasso SSO login...");
  log(`if no browser opens, visit:\n${url.toString()}`);
  await openBrowser(url.toString());

  return codePromise;
}

async function openBrowser(url: string): Promise<void> {
  try {
    const { default: open } = await import("open");
    await open(url);
  } catch (err) {
    log(
      `could not auto-open browser (${stringifyError(err)}); open the URL above manually.`,
    );
  }
}

function waitForAuthorizationCode(port: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (!requestUrl.pathname.startsWith("/auth")) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const code = requestUrl.searchParams.get("code");
      if (!code) {
        res.statusCode = 400;
        res.end("Missing ?code");
        reject(new Error("Oktasso auth: callback missing ?code parameter"));
        server.close();
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(SUCCESS_PAGE);
      setImmediate(() => server.close());
      resolve(code);
    });

    server.on("error", (err) => {
      reject(
        new Error(
          `Oktasso auth: local callback server failed to start on port ${port}: ${stringifyError(err)}`,
        ),
      );
    });

    const TIMEOUT_MS = 120_000;
    const timer = setTimeout(() => {
      server.close();
      reject(
        new Error(
          `Oktasso auth: timed out after ${TIMEOUT_MS / 1000}s waiting for browser callback. Try again.`,
        ),
      );
    }, TIMEOUT_MS);
    timer.unref();

    server.on("close", () => clearTimeout(timer));
    server.listen(port, "127.0.0.1");
  });
}

async function exchangeCodeForAccessToken(
  config: OktassoConfig,
  code: string,
  verifier: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    code_verifier: verifier,
    redirect_uri: config.redirectUri,
  });

  const res = await fetch(new URL("token", config.oauthEndpointBase), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(
      `Oktasso auth: Okta token exchange failed: ${res.status} ${res.statusText}\n${await safeText(res)}`,
    );
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error(
      "Oktasso auth: Okta token response did not include access_token",
    );
  }
  return json.access_token;
}

async function exchangeAccessTokenForOktassoToken(
  config: OktassoConfig,
  accessToken: string,
  audienceUrl: string,
): Promise<string> {
  const url = new URL(config.tokenExchangeUrl);
  url.searchParams.set("audience", audienceUrl);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Oktasso auth: token exchange failed: ${res.status} ${res.statusText}\n${await safeText(res)}`,
    );
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error(
      "Oktasso auth: token exchange response did not include access_token",
    );
  }
  return json.access_token;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

const SUCCESS_PAGE = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Auth successful</title></head>
<body>
  <h2 style="text-align:center;font-family:Arial,Helvetica,sans-serif;color:#909090;margin-top:50px;">
    Auth successful! This window will close shortly.
  </h2>
  <script>setTimeout(function(){window.close();}, 2000);</script>
</body>
</html>`;
