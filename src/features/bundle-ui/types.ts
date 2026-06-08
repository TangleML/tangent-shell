/**
 * Shared contracts for the bundle-UI sandbox runtime (Phase 5).
 *
 * These types describe the bridge that crosses the host <-> worker boundary and
 * are imported by both sides, so the two halves cannot drift. They mirror the
 * documented contract in `docs/bundle-ui/host-bridge.md`. Everything here must
 * be JSON-serializable since it travels over `@quilted/threads`.
 */

/** Which surface a component is rendered on. */
export type BundleUiKind = "message" | "panel";

/** Options for a host-mediated `fetch`, mirroring a tiny subset of `RequestInit`. */
export interface HostRequestInit {
  /** HTTP method; defaults to `GET`. */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Allowlisted request headers. */
  headers?: Record<string, string>;
  /** JSON-serializable body; sent as JSON. */
  body?: unknown;
  /** Query parameters appended to the destination. */
  query?: Record<string, string | number | boolean>;
}

/** JSON-safe stand-in for a `Response` (a live `Response` can't cross a thread). */
export interface HostResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  /** Parsed body when the response is JSON. */
  json?: unknown;
  /** Raw text body otherwise. */
  text?: string;
}

/**
 * The only channel a sandboxed component has to the host. Exposed to the worker
 * over `@quilted/threads`; every call is asynchronous across the boundary.
 */
export interface HostBridge {
  /** JSON props for a `message` component; an empty object for `panel`. */
  getProps(): Promise<Record<string, unknown>>;
  /** Composes and sends a chat message to Prime. */
  sendPrompt(text: string): Promise<void>;
  /** Host-mediated, allowlist-proxied network egress. */
  fetch(input: string, init?: HostRequestInit): Promise<HostResponse>;
}

/** Arguments the host passes to the worker's `render` export. */
export interface RenderOptions {
  /** URL of the compiled component JS to import (the Phase-3 asset). */
  moduleUrl: string;
  /** Component kind, surfaced to the component if it needs it. */
  kind: BundleUiKind;
}

/** The methods the worker exposes back to the host. */
export interface WorkerApi {
  render(connection: unknown, options: RenderOptions): Promise<void>;
}
