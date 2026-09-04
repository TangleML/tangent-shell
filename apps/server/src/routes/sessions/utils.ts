import path from "node:path";

import type { Session } from "@tangent/shared/contracts.ts";
import type { Response } from "express";

import type { SessionStore } from "../../store/sessionStore.ts";

/** Strips path separators/dotfiles from a filename so it can't escape `uploads/`. */
export function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[/\\]/g, "_");
  const cleaned = base.replace(/^\.+/, "").trim();
  return cleaned || "file";
}

/** Rejects ids that aren't a single, traversal-free path segment. */
export function isUnsafeId(id: string): boolean {
  return id.includes("/") || id.includes("\\") || id.includes("..");
}

/** True when `target` is `dir` itself or sits inside it. */
export function isWithin(target: string, dir: string): boolean {
  return target === dir || target.startsWith(dir + path.sep);
}

/**
 * Loads a session by id or, on a miss, responds `404 { error: "Session not
 * found" }` and returns `undefined`. Encapsulates the lookup repeated across
 * nearly every sessions handler so callers can short-circuit with
 * `const session = await loadSession(store, res, id); if (!session) return;`.
 */
export async function loadSession(
  store: Pick<SessionStore, "getSession">,
  res: Response,
  id: string,
): Promise<Session | undefined> {
  const session = await store.getSession(id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return undefined;
  }
  return session;
}
