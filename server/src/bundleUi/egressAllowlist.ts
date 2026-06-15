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
  // return {};

  return {
    cookie: `MINERVA_TOKEN=eyJraWQiOiIzM2QyNDNhZmNkOTVjNzY4ZjQ5OTMzZGJlM2ZkMDVjN2ViMzY3YzVkYTUzNDIxOThlMjA2NGIxYmViMTk5NzczIiwiYWxnIjoiUlMyNTYifQ.eyJyZXF1ZXN0X2lkIjoiZmMzNTQzNDctYmMzOC00MjhkLTgxNWEtMTRmNjQ1MGFkMmNkIiwiYWNjZXNzZWRfc2hvcHMiOnt9LCJhdWQiOiJvYXNpcy5zaG9waWZ5LmlvIiwiZW1haWwiOiJtYXhpbS5lemhvdkBzaG9waWZ5LmNvbSIsImVtcGxveWVlX2lkIjoyMjY3MCwiZXhwIjoxNzgxMDQyNzIxLCJleHRyYSI6bnVsbCwiZmlyc3RfbmFtZSI6Ik1ha3N5bSIsImlhdCI6MTc4MDk1NjMyMSwiaWQiOiI3NWQzZjY1Yy1iYTYxLTRkY2EtOGQyNi1mMDZkNjNmMTdmNzQiLCJpcCI6IjguMjkuMTA5Ljg4IiwiaXNzIjoiTWluZXJ2YSIsImdyb3VwcyI6bnVsbCwibGFzdF9uYW1lIjoiWWV6aG92IiwibWNwIjpudWxsLCJvYXV0aF9jbGllbnRfaWQiOm51bGwsInBlcm1pc3Npb25zIjpudWxsLCJyZXF1aXJlbWVudHMiOlsiYWN0aXZpdHlfc2VnbWVudF9yZXZpZXdzX3JlcXVpcmVkPyIsImF0dGVzdGF0aW9uX3Jldmlld3NfcmVxdWlyZWQ_IiwiYXV0aGVudGljYXRlZF9kZXZpY2U_IiwiYXV0aG9yaXplZF9mb3JfdXNlcl9yb2xlPyIsImNoZWNrX2Nocm9tZWJvb2siLCJjb21wbGV0ZWRfaWRfdmVyaWZpY2F0aW9uPyIsImRvbmVfYWxsX3RyYWluaW5nPyIsImVucm9sbGVkX2luX2ZsZWV0PyIsImV2YWx1YXRlX3Byb3Bvc2VkX3JiYWNfdXBkYXRlcyIsIm1hbmFnZWRfbWFjPyIsInBhc3NrZXlfZW5yb2xsZWQ_IiwicmVxdWlyZV9tYW5hZ2VkX2Jyb3dzZXI_Iiwic2FtZV9kZXZpY2U_Iiwic2VjdXJlX2lvcyIsInNlY3VyZV9tYWNvcz8iLCJzb2Z0YmxvY2tlZF9icG8_IiwidHJ1c3RlZF9kbnM_IiwidXB0b2RhdGVfY2hyb21lX2Jyb3dzZXI_IiwidXNlcl9hY2Nlc3NfcmVzdHJpY3RlZD8iXSwic2hvcF9zbHVnc190b19pZHMiOnt9LCJpbXBlcnNvbmF0b3IiOm51bGwsIm9yaWdpbl9yZWdpb24iOiJVUyJ9.JLcYbXyqeuwCXc0fE6UMsSRaSjin4s_LOpvGH-QBBl_uhOg8-f7CJeATvkTcRlVlq3v8y2jlR0z3h_bwTd3w3cqIPv3TDVjIZ-EvbCVzz218X-pp-xJijNvrW7PQBJF2TMekh8L5OeJSMMWl3-L217FgfwNAHkRoxZ7LJmdfr2jePIJOLoZTQ7nsbFmfDNUnp66Gj3ZAQvm8o0AXyHQwcPdk132ie0MUd67zv-j_4KXO0BHZVAipRaTOMgEqgOJPnShFvIPJRZNIbNIhcHw5BmXDYS_chJ3DK7nBUFBkYXiP_st5XB5B2OglVkJkJGXkp5waJUc-PDNPW4zSM2IQ6w`,
  };

  const token = process.env.OASIS_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * Bearer auth for the Tangle (Cloud Pipelines) API, injected server-side so the
 * agent never holds the token. Unset by default; set `TANGLE_AUTH` to attach
 * `Authorization: Bearer <token>`.
 */
function tangleAuthHeaders(): Record<string, string> {
  const token = process.env.TANGLE_AUTH;
  return token ? { authorization: `Bearer ${token}` } : {};
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
