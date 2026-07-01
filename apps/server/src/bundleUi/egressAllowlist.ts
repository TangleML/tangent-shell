/**
 * Server-side egress allowlist for the bundle-UI `host.fetch` bridge (Phase 5+7).
 *
 * A sandboxed component can only reach destinations registered here; anything
 * else is denied before a network call is made. Components name a logical target
 * and path; the proxy resolves that target from server config, validates it
 * against the allowlist, performs the actual `fetch` server-side, injects any
 * credentials, and strips host internals out of the response.
 *
 * See `docs/bundle-ui/host-bridge.md` for the contract.
 */

import { TANGLE_API_URL } from "../config.ts";

export interface EgressTargetRequest {
  target: "tangle";
  path: string;
}

export type EgressInput = string | EgressTargetRequest;

/** A tiny subset of `RequestInit` that crosses the bridge. */
export interface EgressRequestInit {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | boolean>;
}

/** JSON-safe response returned across the bridge. */
export interface EgressResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  json?: unknown;
  text?: string;
}

/**
 * One allowlisted destination. A request is permitted only when its method and
 * resolved URL match a rule. `headers()` lets the server inject credentials the
 * worker never sees.
 */
interface EgressRule {
  method: NonNullable<EgressRequestInit["method"]>;
  matches(url: URL): boolean;
  headers?(): Record<string, string>;
}

/**
 * Optional credential for the Tangle API, injected server-side as a `Cookie`
 * header. Unset by default (the public executions-state endpoint is
 * unauthenticated); set `TANGLE_TOKEN` to a cookie string such as
 * `OKTASSO_TOKEN=<session>` to authenticate. Generate one with
 * `pnpm tangle:token` (or `pnpm dev:auth`).
 */
function tangleAuthHeaders(): Record<string, string> {
  const token = process.env.TANGLE_TOKEN;
  return token ? { cookie: token } : {};
}

/** Origin of the configured Tangle API; only this host is reachable. */
const TANGLE_API_ORIGIN = new URL(TANGLE_API_URL).origin;

/**
 * Allowlisted Tangle API endpoints (tags `artifacts` / `executions` /
 * `pipelineRuns` from the OpenAPI doc). Reads are GET; run submit/cancel and
 * annotation mutations carry their own methods. Everything else is denied.
 */
const TANGLE_PATH_RULES: ReadonlyArray<{
  method: NonNullable<EgressRequestInit["method"]>;
  test: RegExp;
}> = [
  // pipelineRuns
  { method: "GET", test: /^\/api\/pipeline_runs\/$/ },
  { method: "POST", test: /^\/api\/pipeline_runs\/$/ },
  { method: "GET", test: /^\/api\/pipeline_runs\/[^/]+$/ },
  { method: "POST", test: /^\/api\/pipeline_runs\/[^/]+\/cancel$/ },
  { method: "GET", test: /^\/api\/pipeline_runs\/[^/]+\/annotations\/$/ },
  { method: "PUT", test: /^\/api\/pipeline_runs\/[^/]+\/annotations\/[^/]+$/ },
  {
    method: "DELETE",
    test: /^\/api\/pipeline_runs\/[^/]+\/annotations\/[^/]+$/,
  },
  // executions
  {
    method: "GET",
    test: /^\/api\/executions\/[^/]+\/(state|graph_execution_state|details|container_state|artifacts|container_log|stream_container_log)$/,
  },
  // artifacts
  { method: "GET", test: /^\/api\/artifacts\/[^/]+$/ },
  { method: "GET", test: /^\/api\/artifacts\/[^/]+\/signed_artifact_url$/ },
];

/** Expands the Tangle path rules into full {@link EgressRule}s. */
const TANGLE_RULES: EgressRule[] = TANGLE_PATH_RULES.map((rule) => ({
  method: rule.method,
  matches: (url) =>
    url.origin === TANGLE_API_ORIGIN && rule.test.test(url.pathname),
  headers: tangleAuthHeaders,
}));

/** Registered destinations the bridge may reach. */
const EGRESS_RULES: EgressRule[] = [...TANGLE_RULES];

/** Response headers we are willing to surface back across the bridge. */
const ALLOWED_RESPONSE_HEADERS = new Set(["content-type"]);

/** Abort an upstream request that hangs longer than this. */
const EGRESS_TIMEOUT_MS = 10_000;

/** Raised when a request targets a destination that is not allowlisted. */
export class EgressDeniedError extends Error {
  constructor(input: string) {
    super(`bundle-ui egress destination "${input}" is not allowlisted`);
    this.name = "EgressDeniedError";
  }
}

/** Parses a string as an absolute http(s) URL, or returns `undefined`. */
function parseHttpUrl(input: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  return url;
}

function isEgressTargetRequest(
  input: EgressInput,
): input is EgressTargetRequest {
  return (
    typeof input === "object" && input !== null && input.target === "tangle"
  );
}

/** Picks the allowlisted subset of response headers as a plain object. */
function sanitizeResponseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    if (ALLOWED_RESPONSE_HEADERS.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}

/**
 * Resolves a logical target or absolute http(s) URL with merged query params, or
 * throws {@link EgressDeniedError} for anything that cannot be safely resolved.
 */
function resolveUrl(
  input: EgressInput,
  query: EgressRequestInit["query"],
): URL {
  const url = isEgressTargetRequest(input)
    ? resolveTargetUrl(input)
    : parseHttpUrl(input);
  if (!url) throw new EgressDeniedError(formatDeniedInput(input));
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

export function resolveTargetUrl(input: EgressTargetRequest): URL | undefined {
  if (!input.path.startsWith("/") || input.path.startsWith("//")) {
    return undefined;
  }
  return new URL(input.path, TANGLE_API_URL);
}

function formatDeniedInput(input: EgressInput): string {
  return typeof input === "string" ? input : `${input.target}:${input.path}`;
}

/** Whether this request carries a JSON body (anything but a bodyless GET). */
function isBodyRequest(
  method: NonNullable<EgressRequestInit["method"]>,
  init: EgressRequestInit,
): boolean {
  return method !== "GET" && init.body !== undefined;
}

/** Merges the default, caller, and server-injected headers. */
function buildHeaders(
  init: EgressRequestInit,
  rule: EgressRule,
  hasBody: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(init.headers ?? {}),
    ...(rule.headers?.() ?? {}),
  };
  if (hasBody) headers["content-type"] = "application/json";
  return headers;
}

/** Builds the outbound request init: caller + injected headers, optional body. */
function buildRequestInit(
  method: NonNullable<EgressRequestInit["method"]>,
  init: EgressRequestInit,
  rule: EgressRule,
  signal: AbortSignal,
): RequestInit {
  const hasBody = isBodyRequest(method, init);
  return {
    method,
    headers: buildHeaders(init, rule, hasBody),
    body: hasBody ? JSON.stringify(init.body) : undefined,
    signal,
  };
}

/** Performs the proxied request under a timeout, returning the live response. */
async function performFetch(
  url: URL,
  method: NonNullable<EgressRequestInit["method"]>,
  init: EgressRequestInit,
  rule: EgressRule,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EGRESS_TIMEOUT_MS);
  try {
    return await fetch(
      url,
      buildRequestInit(method, init, rule, controller.signal),
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Reads the response body into the JSON-safe `EgressResponse` shape. */
async function toEgressResponse(response: Response): Promise<EgressResponse> {
  const text = await response.text();
  const isJson = (response.headers.get("content-type") ?? "").includes(
    "application/json",
  );
  let json: unknown;
  if (isJson && text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      // Upstream mislabeled the body; fall back to raw text below.
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    headers: sanitizeResponseHeaders(response.headers),
    ...(json !== undefined ? { json } : { text }),
  };
}

/**
 * Resolves an allowlisted egress request by performing the real network call
 * server-side. Throws {@link EgressDeniedError} when `input` cannot resolve to a
 * registered destination. Network/transport failures propagate as generic
 * errors (the route maps them to a 502).
 */
export async function resolveEgress(
  input: EgressInput,
  init: EgressRequestInit = {},
): Promise<EgressResponse> {
  const method = init.method ?? "GET";
  const url = resolveUrl(input, init.query);
  const rule = EGRESS_RULES.find(
    (entry) => entry.method === method && entry.matches(url),
  );
  if (!rule) throw new EgressDeniedError(formatDeniedInput(input));

  const response = await performFetch(url, method, init, rule);
  return toEgressResponse(response);
}
