/**
 * The contract that crosses the host <-> worker boundary for a UI extension.
 *
 * These types describe the `host` bridge a sandboxed component talks to. They
 * are the single source of truth shared by the SDK (author side), the web host,
 * and the worker runtime, so the halves cannot drift. Everything here must be
 * JSON-serializable since it travels over `@quilted/threads`.
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

/** A server-resolved egress target, addressed by name + path rather than URL. */
export interface HostTargetRequest {
  target: "tangle";
  path: string;
}

/** What `host.fetch` accepts: an absolute URL or a server-resolved target. */
export type HostFetchInput = string | HostTargetRequest;

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
 * A host UI action a component can request through {@link HostBridge.execUICommand}.
 *
 * Modeled as a discriminated union (rather than bespoke methods) so new actions
 * can be added — each carrying its own payload — without growing the bridge
 * surface. `collapse` collapses the chat message the component is rendered in,
 * URL commands open either a supplied `https:` URL or a server-configured
 * target URL in a new browser tab, and `openTab` opens a full-screen in-app tab
 * hosted by the app (e.g. the embedded Tangle pipeline editor).
 */
export type UICommand =
  | { type: "collapse" }
  | { type: "openUrl"; url: string }
  | { type: "openTargetUrl"; target: "tangle"; path: string }
  | { type: "openTab"; tab: "pipeline-editor"; title?: string };

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
  fetch(input: HostFetchInput, init?: HostRequestInit): Promise<HostResponse>;
  /**
   * Reads a previously persisted value for `key` from this instance's
   * key-value store, or `null` if absent. State survives page reloads and is
   * scoped to the message instance; `panel` components have no store.
   */
  getState(key: string): Promise<unknown>;
  /** Persists a JSON-serializable `value` under `key` for this instance. */
  setState(key: string, value: unknown): Promise<void>;
  /**
   * Requests a host UI action: collapse the component's message, open a URL /
   * server-resolved target in a new browser tab, or open a full-screen in-app
   * tab (`openTab`) such as the embedded Tangle pipeline editor.
   */
  execUICommand(command: UICommand): Promise<void>;
}
