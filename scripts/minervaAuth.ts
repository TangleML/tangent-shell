/**
 * Minerva (Shopify SSO) authentication via Okta PKCE flow.
 *
 * Mirrors `rowlet.auth.MinervaAuth` (Python) — the helper that `tangle_deploy`
 * uses to obtain a `MINERVA_TOKEN` cookie for authenticated requests against
 * Oasis / Tangle.
 *
 * Flow:
 *   1. Generate PKCE verifier + challenge.
 *   2. Open the user's browser at Okta's `/authorize`.
 *   3. Run a one-shot HTTP server on http://localhost:3001/auth to catch the
 *      redirect with the authorization code.
 *   4. Exchange the code for an Okta access token at `/token`.
 *   5. Exchange the access token for a Minerva session token via
 *      `https://minerva.shopifycloud.com/client_auth/okta_token_exchange/`,
 *      passing the target API base URL as the `audience` parameter.
 *   6. Return headers `{ cookie: "MINERVA_TOKEN=<session>" }` and persist them
 *      to `~/.cache/tangle-deploy/minerva_token.json` so subsequent CLI
 *      invocations don't re-prompt for login.
 *
 * The on-disk cache shape intentionally matches what the Python client writes,
 * so the two can share the same file.
 */

import "./env.ts";

import crypto from "node:crypto";
import http from "node:http";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import open from "open";

/** Reads a config value sourced from `.env` (validated in `./env.ts`). */
function env(name: string): string {
  return process.env[name] ?? "";
}

const OAUTH_ENDPOINT_BASE = env("MINERVA_OAUTH_ENDPOINT_BASE");
const MINERVA_ENDPOINT_BASE = env("MINERVA_TOKEN_EXCHANGE_URL");
const SCOPES = env("MINERVA_SCOPES");

const DEFAULT_CLIENT_ID = env("MINERVA_CLIENT_ID");
const DEFAULT_REDIRECT_URI = env("MINERVA_REDIRECT_URI");
const DEFAULT_CALLBACK_PORT = Number(env("MINERVA_CALLBACK_PORT"));
const DEFAULT_REFRESH_AFTER_MS = Number(env("MINERVA_REFRESH_AFTER_MS"));

const CACHE_DIR = path.join(os.homedir(), ".cache", "tangle-deploy");
const CACHE_FILE = path.join(CACHE_DIR, "minerva_token.json");

export interface MinervaHeaders {
  cookie: string;
  expiry?: string;
}

export interface GetMinervaHeadersOptions {
  baseUrl: string;
  clientId?: string;
  refreshAfterMs?: number;
  /** If true, skip reading the on-disk cache and force a fresh auth flow. */
  forceRefresh?: boolean;
}

interface CachedTokenPayload {
  headers: MinervaHeaders;
  base_url: string;
  created_at: number; // seconds since epoch, matching Python's time.time()
}

/**
 * Top-level entry. Returns headers (with `cookie`) suitable for attaching to
 * fetch requests targeting `baseUrl`. Uses the on-disk cache when fresh and
 * for the same base URL; otherwise runs the full PKCE browser flow.
 */
export async function getMinervaHeaders(
  opts: GetMinervaHeadersOptions,
): Promise<MinervaHeaders> {
  const clientId = opts.clientId ?? DEFAULT_CLIENT_ID;
  const refreshAfterMs = opts.refreshAfterMs ?? DEFAULT_REFRESH_AFTER_MS;

  if (!opts.forceRefresh) {
    const cached = await loadCachedToken(opts.baseUrl, refreshAfterMs);
    if (cached) return cached;
  }

  const headers = await runAuthFlow(clientId, opts.baseUrl);
  await saveCachedToken(headers, opts.baseUrl);
  return headers;
}

async function loadCachedToken(
  baseUrl: string,
  refreshAfterMs: number,
): Promise<MinervaHeaders | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    const payload = JSON.parse(raw) as CachedTokenPayload;
    if (payload.base_url !== baseUrl) return null;
    const ageMs = Date.now() - payload.created_at * 1000;
    if (ageMs >= refreshAfterMs) return null;
    if (!payload.headers?.cookie) return null;
    return payload.headers;
  } catch {
    return null;
  }
}

async function saveCachedToken(
  headers: MinervaHeaders,
  baseUrl: string,
): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true, mode: 0o700 });
    const payload: CachedTokenPayload = {
      headers,
      base_url: baseUrl,
      created_at: Date.now() / 1000,
    };
    await writeFile(CACHE_FILE, JSON.stringify(payload), { mode: 0o600 });
    // writeFile honours `mode` only when creating; chmod to be safe on reuse.
    await chmod(CACHE_FILE, 0o600);
  } catch (err) {
    console.warn(
      `[minervaAuth] warning: could not cache Minerva token: ${stringifyError(err)}`,
    );
  }
}

async function runAuthFlow(
  clientId: string,
  audienceUrl: string,
): Promise<MinervaHeaders> {
  const { verifier, challenge } = generatePkcePair();
  const code = await getAuthorizationCode(clientId, challenge);
  const accessToken = await exchangeCodeForAccessToken(
    clientId,
    code,
    verifier,
  );
  const minervaToken = await exchangeAccessTokenForMinervaToken(
    accessToken,
    audienceUrl,
  );
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return {
    cookie: `MINERVA_TOKEN=${minervaToken}`,
    expiry: formatExpiry(expiry),
  };
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
  clientId: string,
  challenge: string,
): Promise<string> {
  const codePromise = waitForAuthorizationCode(DEFAULT_CALLBACK_PORT);

  const url = new URL("authorize", OAUTH_ENDPOINT_BASE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("callback_url", DEFAULT_REDIRECT_URI);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", "1234");
  url.searchParams.set("redirect_uri", DEFAULT_REDIRECT_URI);

  console.error(
    "[minervaAuth] opening browser for Shopify SSO login (Minerva)...",
  );
  console.error(`[minervaAuth] if no browser opens, visit:\n${url.toString()}`);

  try {
    await open(url.toString());
  } catch (err) {
    console.warn(
      `[minervaAuth] could not auto-open browser (${stringifyError(err)}); please open the URL above manually.`,
    );
  }

  return codePromise;
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
        reject(new Error("Minerva auth: callback missing ?code parameter"));
        server.close();
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(SUCCESS_PAGE);
      // Defer close so the response flushes.
      setImmediate(() => server.close());
      resolve(code);
    });

    server.on("error", (err) => {
      reject(
        new Error(
          `Minerva auth: local callback server failed to start on port ${port}: ${stringifyError(err)}`,
        ),
      );
    });

    const TIMEOUT_MS = 120_000;
    const timer = setTimeout(() => {
      server.close();
      reject(
        new Error(
          `Minerva auth: timed out after ${TIMEOUT_MS / 1000}s waiting for browser callback. Try again.`,
        ),
      );
    }, TIMEOUT_MS);
    timer.unref();

    server.on("close", () => clearTimeout(timer));

    server.listen(port, "127.0.0.1");
  });
}

async function exchangeCodeForAccessToken(
  clientId: string,
  code: string,
  verifier: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: DEFAULT_REDIRECT_URI,
  });

  const res = await fetch(new URL("token", OAUTH_ENDPOINT_BASE), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(
      `Minerva auth: Okta token exchange failed: ${res.status} ${res.statusText}\n${await safeText(res)}`,
    );
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error(
      "Minerva auth: Okta token response did not include access_token",
    );
  }
  return json.access_token;
}

async function exchangeAccessTokenForMinervaToken(
  accessToken: string,
  audienceUrl: string,
): Promise<string> {
  // The Python rowlet client uses GET with a form-encoded body
  // (`requests.get(..., data=payload)`). Node's fetch (undici) forbids
  // bodies on GET regardless of `duplex`, so we send `audience` as a
  // query parameter instead — Minerva accepts either form.
  const url = new URL(MINERVA_ENDPOINT_BASE);
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
      `Minerva auth: token exchange failed: ${res.status} ${res.statusText}\n${await safeText(res)}`,
    );
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error(
      "Minerva auth: token exchange response did not include access_token",
    );
  }
  return json.access_token;
}

function formatExpiry(d: Date): string {
  // Matches Python's "%m-%d-%Y-%H-%M-%S".
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    d.getFullYear(),
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join("-");
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
  <div style="text-align:center;">
    <img alt="Shopify" src="https://cdn.shopify.com/assets/images/logos/shopify-bag.png">
  </div>
  <h4 style="text-align:center;font-family:Arial,Helvetica,sans-serif;color:#B0B0B0;margin-top:30px;">
    Shopify
  </h4>
  <script>setTimeout(function(){window.close();}, 2000);</script>
</body>
</html>`;
