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

import { TANGLE_API_URL, TANGLE_TEAM_HEADER } from "../config.ts";

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

/** How one egress request may act as a Tangle team. */
export interface EgressOptions {
  /** The team the caller's Run may act as; the server's, never the caller's. */
  grantedTeam?: string;
  /** The caller's ask to act as {@link grantedTeam} on this request. */
  actAsTeam?: boolean;
}

/** An egress response plus the team the request went upstream as, if any. */
export interface TeamEgressResult {
  response: EgressResponse;
  /** The value sent in {@link TANGLE_TEAM_HEADER}; unset when none was sent. */
  appliedTeam?: string;
}

/**
 * One allowlisted destination. A request is permitted only when its method and
 * resolved URL match a rule. `headers()` lets the server inject credentials the
 * worker never sees; `actsAsTeam` rules may act as the caller's granted team.
 */
interface EgressRule {
  method: NonNullable<EgressRequestInit["method"]>;
  agentOnly?: boolean;
  matches(url: URL): boolean;
  headers?(): Record<string, string>;
  actsAsTeam?: boolean;
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

const SAVED_PIPELINE_API_PATH =
  /^\/api\/pipelines\/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/**
 * Allowlisted Tangle API endpoints; everything else is denied. Saved-pipeline
 * creation targets the authenticated caller, and updates address a stable UUID
 * under the backend's resource permissions. `actsAsTeam` rules may act as the
 * caller's granted team.
 */
const TANGLE_PATH_RULES: ReadonlyArray<{
  method: NonNullable<EgressRequestInit["method"]>;
  test: RegExp;
  agentOnly?: boolean;
  actsAsTeam?: boolean;
}> = [
  // saved pipelines / authenticated backend identity
  { method: "GET", test: /^\/api\/users\/me$/, agentOnly: true },
  { method: "GET", test: /^\/api\/users\/me\/pipelines$/, agentOnly: true },
  { method: "PUT", test: /^\/api\/users\/me\/pipelines$/, agentOnly: true },
  { method: "GET", test: SAVED_PIPELINE_API_PATH, agentOnly: true },
  { method: "PUT", test: SAVED_PIPELINE_API_PATH, agentOnly: true },
  // pipelineRuns
  { method: "GET", test: /^\/api\/pipeline_runs\/$/ },
  { method: "POST", test: /^\/api\/pipeline_runs\/$/, actsAsTeam: true },
  { method: "GET", test: /^\/api\/pipeline_runs\/[^/]+$/ },
  {
    method: "POST",
    test: /^\/api\/pipeline_runs\/[^/]+\/cancel$/,
    actsAsTeam: true,
  },
  { method: "GET", test: /^\/api\/pipeline_runs\/[^/]+\/annotations\/$/ },
  {
    method: "PUT",
    test: /^\/api\/pipeline_runs\/[^/]+\/annotations\/[^/]+$/,
    actsAsTeam: true,
  },
  {
    method: "DELETE",
    test: /^\/api\/pipeline_runs\/[^/]+\/annotations\/[^/]+$/,
    actsAsTeam: true,
  },
  // executions
  {
    method: "GET",
    test: /^\/api\/executions\/[^/]+\/(state|graph_execution_state|details|container_state|artifacts|container_log|stream_container_log)$/,
  },
  // artifacts
  { method: "GET", test: /^\/api\/artifacts\/[^/]+$/ },
  { method: "GET", test: /^\/api\/artifacts\/[^/]+\/signed_artifact_url$/ },
  // projects / workspaces
  { method: "GET", test: /^\/api\/projects(?:\/.*)?$/ },
  { method: "GET", test: /^\/api\/workspaces(?:\/.*)?$/ },
  { method: "POST", test: /^\/api\/projects(?:\/.*)?$/ },
  { method: "PATCH", test: /^\/api\/projects(?:\/.*)?$/ },
  // secrets (list only: names and metadata, never values)
  { method: "GET", test: /^\/api\/secrets\/$/, actsAsTeam: true },
];

/** Expands the Tangle path rules into full {@link EgressRule}s. */
const TANGLE_RULES: EgressRule[] = TANGLE_PATH_RULES.map((rule) => ({
  method: rule.method,
  agentOnly: rule.agentOnly,
  matches: (url) =>
    url.origin === TANGLE_API_ORIGIN && rule.test.test(url.pathname),
  headers: tangleAuthHeaders,
  actsAsTeam: rule.actsAsTeam,
}));

/** Registered destinations the bridge may reach. */
const EGRESS_RULES: EgressRule[] = [...TANGLE_RULES];

/** Response headers we are willing to surface back across the bridge. */
const ALLOWED_RESPONSE_HEADERS = new Set(["content-type"]);

/** Callers control content negotiation, never upstream authentication/identity. */
const ALLOWED_REQUEST_HEADERS = new Set(["accept", "content-type"]);

/** Abort an upstream request that hangs longer than this. */
const EGRESS_TIMEOUT_MS = 10_000;

/** Raised when a request targets a destination that is not allowlisted. */
export class EgressDeniedError extends Error {
  constructor(input: string) {
    super(`bundle-ui egress destination "${input}" is not allowlisted`);
    this.name = "EgressDeniedError";
  }
}

/** Safe diagnostics for callers; underlying errors can contain credentials or URLs. */
export class EgressUpstreamError extends Error {
  constructor(cause: unknown) {
    const timedOut = cause instanceof Error && cause.name === "AbortError";
    super(
      timedOut
        ? "Tangle API request timed out. Check upstream availability; a write may still have persisted."
        : "Could not reach the Tangle API. Check TANGLE_API_URL, the trusted server authentication/proxy configuration, and upstream availability.",
      { cause },
    );
    this.name = "EgressUpstreamError";
  }
}

/** Raised when a request asks to act as a team its turn was not granted. */
export class TeamNotGrantedError extends Error {
  constructor() {
    super("no Tangle team is granted for this turn");
    this.name = "TeamNotGrantedError";
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

/** The granted team, if `rule` acts as one and the caller asked to. */
function teamFor(
  rule: EgressRule,
  { grantedTeam, actAsTeam }: EgressOptions,
): string | undefined {
  if (!rule.actsAsTeam || !actAsTeam) return undefined;
  if (!grantedTeam) throw new TeamNotGrantedError();
  return grantedTeam;
}

/** Merges safe caller headers with authoritative server credentials. */
function buildHeaders(
  init: EgressRequestInit,
  rule: EgressRule,
  team: string | undefined,
  hasBody: boolean,
): Record<string, string> {
  const callerHeaders = Object.entries(init.headers ?? {})
    .map(([name, value]) => [name.toLowerCase(), value])
    .filter(([name]) => ALLOWED_REQUEST_HEADERS.has(name));
  const headers: Record<string, string> = {
    accept: "application/json",
    ...Object.fromEntries(callerHeaders),
    ...(rule.headers?.() ?? {}),
    ...(team ? { [TANGLE_TEAM_HEADER]: team } : {}),
  };
  if (hasBody) headers["content-type"] = "application/json";
  return headers;
}

/** Builds the outbound request init: caller + injected headers, optional body. */
function buildRequestInit(
  method: NonNullable<EgressRequestInit["method"]>,
  init: EgressRequestInit,
  rule: EgressRule,
  team: string | undefined,
  signal: AbortSignal,
): RequestInit {
  const hasBody = isBodyRequest(method, init);
  return {
    method,
    headers: buildHeaders(init, rule, team, hasBody),
    body: hasBody ? JSON.stringify(init.body) : undefined,
    signal,
  };
}

/** Fetches and consumes the response under one timeout, including a stalled body. */
async function performFetch(
  url: URL,
  method: NonNullable<EgressRequestInit["method"]>,
  init: EgressRequestInit,
  rule: EgressRule,
  team: string | undefined,
): Promise<EgressResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EGRESS_TIMEOUT_MS);
  try {
    const response = await fetch(
      url,
      buildRequestInit(method, init, rule, team, controller.signal),
    );
    return await toEgressResponse(response);
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
 * server-side, acting as the granted team on a team-scoped rule only when the
 * caller asks to. Throws {@link EgressDeniedError} when `input` cannot resolve
 * to a registered destination for this host-selected caller, and
 * {@link TeamNotGrantedError} when the caller asks for a team it wasn't
 * granted. UI callers cannot opt into agent-only rules through the request
 * body. Upstream failures map to a 502 with safe diagnostics; backend status
 * codes and bodies are preserved.
 */
export async function resolveEgressWithTeam(
  input: EgressInput,
  init: EgressRequestInit = {},
  caller: "ui" | "agent" = "ui",
  options: EgressOptions = {},
): Promise<TeamEgressResult> {
  const method = init.method ?? "GET";
  const url = resolveUrl(input, init.query);
  const rule = EGRESS_RULES.find(
    (entry) =>
      (!entry.agentOnly || caller === "agent") &&
      entry.method === method &&
      entry.matches(url),
  );
  if (!rule) throw new EgressDeniedError(formatDeniedInput(input));

  const appliedTeam = teamFor(rule, options);
  try {
    const response = await performFetch(url, method, init, rule, appliedTeam);
    return { response, appliedTeam };
  } catch (error) {
    console.warn(
      `[egress] ${method} ${url.origin}${url.pathname} failed: ${describeFailure(error)}`,
    );
    throw new EgressUpstreamError(error);
  }
}

/** {@link resolveEgressWithTeam} for a caller that never acts as a team. */
export async function resolveEgress(
  input: EgressInput,
  init: EgressRequestInit = {},
  caller: "ui" | "agent" = "ui",
): Promise<EgressResponse> {
  return (await resolveEgressWithTeam(input, init, caller)).response;
}

/** Name and code only: transport error messages can carry credentials. */
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const { cause } = error;
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? String(cause.code)
      : undefined;
  return code ? `${error.name} (${code})` : error.name;
}
