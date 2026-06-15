import { randomUUID } from "node:crypto";
import path from "node:path";

import { DEFAULT_MODEL_ID, DEFAULT_THINKING_LEVEL } from "@shared/contracts.ts";

/** Port the dev server listens on. Vite proxies /api and /socket.io here. */
export const PORT = Number(process.env.PORT ?? 8787);

/**
 * Root directory that holds every session's scoped folder. Each session gets
 * its own subdirectory (`SESSIONS_ROOT/<id>`) which a Pi worker will run in.
 * Gitignored by default.
 */
export const SESSIONS_ROOT =
  process.env.SESSIONS_ROOT ?? path.resolve(process.cwd(), ".sessions");

/**
 * SQLite database file backing session, asset, and agent-roster metadata.
 * Chat history is not stored here; it lives as per-conversation JSONL files
 * inside each session's folder. Defaults to a `tangent.db` alongside the
 * session folders so a single persistent volume covers everything.
 */
export const SESSIONS_DB =
  process.env.SESSIONS_DB ?? path.join(SESSIONS_ROOT, "tangent.db");

/**
 * Root directory backing the agent bundle marketplace. Each saved bundle gets
 * its own subdirectory (`AGENT_BUNDLES_ROOT/<id>`) holding the original ZIP,
 * extracted metadata, and icon. Gitignored by default.
 */
export const AGENT_BUNDLES_ROOT =
  process.env.AGENT_BUNDLES_ROOT ??
  path.resolve(process.cwd(), ".agent-bundles");

/**
 * Name of the per-session subdirectory whose contents are served over HTTP as
 * artifacts (images, generated HTML pages, reports). Agents write user-facing
 * outputs here and reference them by this relative path; the file API only
 * exposes paths inside this folder.
 */
export const ARTIFACTS_DIRNAME = "artifacts";

/**
 * Name of the per-session subdirectory that holds files a human uploads into
 * the session via the chat composer. Files land here so the Pi worker (running
 * with its cwd set to the session root) can read them by their relative path,
 * and the file API can serve them back to the chat UI.
 */
export const UPLOADS_DIRNAME = "uploads";

/**
 * Root directory holding the agents' global memory: long-lived facts that apply
 * across every session. It is injected (read-only context) into each session at
 * spawn and is only mutated on an explicit user request. Gitignored by default.
 */
export const GLOBAL_MEMORY_DIR =
  process.env.GLOBAL_MEMORY_DIR ?? path.resolve(process.cwd(), ".memory");

/**
 * Canonical, agent-writable global memory file inside {@link GLOBAL_MEMORY_DIR}.
 * A snapshot of its contents is also copied into each session root under the
 * same basename so the agent can read it with its own file tools.
 */
export const GLOBAL_MEMORY_FILENAME = "GLOBAL_MEMORY.md";

/**
 * Canonical, agent-writable per-session memory file, kept at the session root.
 * Seeded from a bundle's `memory/MEMORY.md` when present; otherwise Prime
 * creates it on its first `remember`.
 */
export const SESSION_MEMORY_FILENAME = "MEMORY.md";

/**
 * Executable used to spawn the Pi coding agent. Overridable so the binary can
 * be pinned in environments where `pi` is not on PATH.
 */
export const PI_BIN = process.env.PI_BIN ?? "pi";

/**
 * Base URL of the LLM proxy the bundled proxy-provider extension points Pi at.
 * Defaults to the Shopify proxy so local behavior matches the auto-discovered
 * `~/.pi/agent` extension; override in deployments (e.g. Cloud Run) to target a
 * different proxy. Mirrored here for logging; the extension reads it directly.
 */
export const PI_PROXY_URL =
  process.env.PI_PROXY_URL ?? "https://proxy.shopify.ai";

/**
 * Provider/model Pi is pinned to when spawned. In the container there is no
 * `~/.pi/agent/settings.json`, so these are passed explicitly to match the
 * local defaults (`openai` / `gpt-5.5`).
 */
const [DEFAULT_PROVIDER, DEFAULT_MODEL] = DEFAULT_MODEL_ID.split("/");

export const PI_PROVIDER = process.env.PI_PROVIDER ?? DEFAULT_PROVIDER;
export const PI_MODEL = process.env.PI_MODEL ?? DEFAULT_MODEL;

/**
 * Default thinking depth Pi is spawned with via `--thinking` when an agent has
 * no explicit selection. One of Pi's levels: off, minimal, low, medium, high,
 * xhigh. Overridable per environment and per agent at runtime.
 */
export const PI_THINKING = process.env.PI_THINKING ?? DEFAULT_THINKING_LEVEL;

/**
 * When enabled, the Pi manager emits verbose logs including raw stdout RPC
 * lines. Lifecycle logs are always emitted regardless of this flag. Defaults to
 * true for now (set PI_DEBUG=0/false/no to silence the verbose stream).
 */
export const PI_DEBUG = !/^(0|false|no)$/i.test(process.env.PI_DEBUG ?? "");

/**
 * Base URL the orchestrator extension (running inside each Pi process) uses to
 * reach this server's internal agent API. Defaults to loopback on {@link PORT}.
 */
export const INTERNAL_URL =
  process.env.TANGENT_INTERNAL_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * Shared secret the orchestrator extension must present (as a bearer token) to
 * call the internal agent API. Generated per server start unless pinned via env
 * so arbitrary local processes can't drive a session's agents.
 */
export const INTERNAL_TOKEN =
  process.env.TANGENT_INTERNAL_TOKEN ?? randomUUID();

/**
 * Base URL of the Tangle (Cloud Pipelines) API reached by the bundle-UI/agent
 * egress allowlist. The OpenAPI doc declares no `servers`, so this is supplied
 * per environment: defaults to the local dev server and is overridden in
 * production. Only the origin is used when matching egress destinations.
 */
export const TANGLE_API_URL =
  process.env.TANGLE_API_URL ?? "https://oasis.shopify.io";
