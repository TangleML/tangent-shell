import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  DEFAULT_MODEL_ID,
  DEFAULT_THINKING_LEVEL,
} from "@tangent/shared/contracts.ts";

function readAbsoluteUrl(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  try {
    new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  return value;
}

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
 * Override in deployments to target the proxy available in that environment.
 * Mirrored here for logging; the extension reads it directly.
 */
export const PI_PROXY_URL = readAbsoluteUrl(
  "PI_PROXY_URL",
  "https://proxy.example.com",
);

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
 * When enabled (the default), a Message is delivered to a room per Conversation
 * rather than one room per session: a socket joins only the Conversation rooms
 * its Participant is authorized for, so who receives a Message is a server-side
 * decision derived from Membership rather than a client-side render filter. Set
 * `ROOM_PER_CONVERSATION=0/false/no` to fall back to the session-scoped room —
 * a rollback for this PR only; a later cleanup removes the flag.
 */
export const ROOM_PER_CONVERSATION = !/^(0|false|no)$/i.test(
  process.env.ROOM_PER_CONVERSATION ?? "",
);

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
 * Public base URL at which this server is reachable by an external MCP client
 * (the gateway dials in over this). The server cannot self-discover it, so it
 * is supplied per environment: a tunnel URL in local dev, the reverse-proxy URL
 * in a real instance. Empty by default, which disables issuing relay channels
 * until set. No trailing slash.
 */
export const PUBLIC_URL = (process.env.TANGENT_PUBLIC_URL ?? "").replace(
  /\/+$/,
  "",
);

/**
 * Shared secret a remote environment must present (in the Socket.IO handshake
 * `auth`) to connect to the remote sub-agent gateway. Empty by default, which
 * disables remote sub-agent hosting until an environment supplies a token so a
 * stray connection can never drive a session's agents.
 */
export const REMOTE_ENV_TOKEN = process.env.REMOTE_ENV_TOKEN ?? "";

/**
 * HMAC key used to mint and verify scoped `/remote-env` tokens for embed hosts.
 * Generated per server start unless pinned via env. Independent of
 * {@link REMOTE_ENV_TOKEN} (the optional server-to-server shared secret) and of
 * {@link INTERNAL_TOKEN} (which Pi children inherit).
 */
export const REMOTE_ENV_SIGNING_SECRET =
  process.env.REMOTE_ENV_SIGNING_SECRET ?? randomUUID();

/**
 * Secret Tangent presents (as a bearer token) to an attached A2A agent. Unlike
 * the other connector secrets this one travels outbound, so an empty value is
 * not a lockout: a peer that asks for no credential is still reachable.
 */
export const A2A_TOKEN = process.env.A2A_TOKEN ?? "";

/**
 * Name of the cookie holding the Oktasso JWT that `GET /api/me` reads to resolve
 * the current user. Empty by default so the route is effectively disabled until
 * an environment supplies the cookie name (the local `dev` script sets it).
 */
export const AUTH_JWT_TOKEN_COOKIE_NAME =
  process.env.AUTH_JWT_TOKEN_COOKIE_NAME ?? "";

/**
 * Origins allowed to embed the UI cross-origin (the host pages running
 * `@tangent/embed-react`). Comma-separated; drives both the `/api` CORS headers
 * and the Socket.IO handshake allowlist. Empty by default so a same-origin
 * deployment grants no cross-origin trust.
 */
export const EMBED_ALLOWED_ORIGINS = (process.env.EMBED_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Base URL of the Tangle API reached by the bundle-UI/agent egress allowlist.
 * The OpenAPI doc declares no `servers`, so this is supplied per environment.
 * Only the origin is used when matching egress destinations.
 */
export const TANGLE_API_URL = readAbsoluteUrl(
  "TANGLE_API_URL",
  "https://api.example.com",
);
