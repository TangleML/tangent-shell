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
