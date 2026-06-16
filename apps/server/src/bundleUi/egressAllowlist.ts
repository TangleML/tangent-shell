/**
 * Server-side egress allowlist for the bundle-UI `host.fetch` bridge (Phase 5+7).
 *
 * A sandboxed component can only reach destinations registered here; anything
 * else is denied before a network call is made. Unlike the earlier alias-based
 * stub, components now name a **real, full URL** (e.g. the Oasis executions API)
 * and the proxy validates it against the allowlist of host/path patterns, then
 * performs the actual `fetch` server-side, injecting any credentials and
 * stripping host internals out of the response.
 *
 * See `docs/bundle-ui/host-bridge.md` for the contract.
 */

import { TANGLE_API_URL } from "../config.ts";

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
 * One allowlisted destination. The component supplies the full URL; a request
 * is permitted only when its method and parsed URL match a rule. `headers()`
 * lets the server inject credentials the worker never sees.
 */
interface EgressRule {
  method: NonNullable<EgressRequestInit["method"]>;
  matches(url: URL): boolean;
  headers?(): Record<string, string>;
}

/**
 * Optional bearer token for the Oasis API, injected server-side. Unset by
 * default (the public executions-state endpoint is unauthenticated); set
 * `OASIS_TOKEN` to attach `Authorization: Bearer <token>`.
 */
function oasisAuthHeaders(): Record<string, string> {
  const token = process.env.OASIS_TOKEN;
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
  headers: oasisAuthHeaders,
}));

/** Registered destinations the bridge may reach. */
const EGRESS_RULES: EgressRule[] = [
  {
    // Oasis execution state, e.g.
    // https://oasis.shopify.io/api/executions/019ea56d72cd5f4d75f6/state
    method: "GET",
    matches: (url) =>
      url.origin === "https://oasis.shopify.io" &&
      /^\/api\/executions\/[^/]+\/state$/.test(url.pathname),
    headers: oasisAuthHeaders,
  },
  ...TANGLE_RULES,
];

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

/** Parses `input` as an absolute http(s) URL, or returns `undefined`. */
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

/** Picks the allowlisted subset of response headers as a plain object. */
function sanitizeResponseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    if (ALLOWED_RESPONSE_HEADERS.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}

/**
 * Resolves an absolute http(s) URL with merged query params, or throws
 * {@link EgressDeniedError} for anything that isn't an http(s) URL.
 */
function resolveUrl(input: string, query: EgressRequestInit["query"]): URL {
  const url = parseHttpUrl(input);
  if (!url) throw new EgressDeniedError(input);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
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
 * server-side. Throws {@link EgressDeniedError} when `input` is not an absolute
 * http(s) URL matching a registered destination. Network/transport failures
 * propagate as generic errors (the route maps them to a 502).
 */
export async function resolveEgress(
  input: string,
  init: EgressRequestInit = {},
): Promise<EgressResponse> {
  const method = init.method ?? "GET";
  const url = resolveUrl(input, init.query);
  const rule = EGRESS_RULES.find(
    (entry) => entry.method === method && entry.matches(url),
  );
  if (!rule) throw new EgressDeniedError(input);

  const response = await performFetch(url, method, init, rule);
  return toEgressResponse(response);
}
