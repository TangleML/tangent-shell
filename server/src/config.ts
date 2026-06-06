import { randomUUID } from "node:crypto";
import path from "node:path";

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
 * Executable used to spawn the Pi coding agent. Overridable so the binary can
 * be pinned in environments where `pi` is not on PATH.
 */
export const PI_BIN = process.env.PI_BIN ?? "pi";

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
export const INTERNAL_TOKEN = process.env.TANGENT_INTERNAL_TOKEN ?? randomUUID();
