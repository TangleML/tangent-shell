import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { stringify as stringifyYaml } from "yaml";

import { QMD_STATE_ROOT, SESSIONS_ROOT, SHARED_ROOT } from "../config.ts";
import { canonicalPath, isStrictlyInside } from "./paths.ts";

/** The one collection name pi-memory searches (`qmd ... -c pi-memory`). */
const COLLECTION = "pi-memory";

/** Mirrors the path contexts pi-memory registers when it creates the collection. */
const CONTEXTS = {
  "/daily": "Daily append-only work logs organized by date",
  "/": "Curated long-term memory: decisions, preferences, facts, lessons",
};

const LOCAL_CONFIG_NAMES = ["index.yaml", "index.yml"];

/**
 * Where a store's qmd state lives under {@link QMD_STATE_ROOT}, keyed by the
 * store's canonical path relative to the shared-folder or sessions root. Every
 * session resolving to the same store gets the same index; keys stay stable if
 * either root moves.
 */
export function qmdStateDir(store: string): string {
  const canonical = canonicalPath(store);
  const scopes: [string, string][] = [
    ["shared", canonicalPath(SHARED_ROOT)],
    ["sessions", canonicalPath(SESSIONS_ROOT)],
  ];
  for (const [scope, root] of scopes) {
    if (isStrictlyInside(canonical, root)) {
      return path.join(QMD_STATE_ROOT, scope, path.relative(root, canonical));
    }
  }
  const digest = createHash("sha256").update(canonical).digest("hex");
  return path.join(QMD_STATE_ROOT, "other", digest.slice(0, 16));
}

/**
 * Writes the store's qmd config: exactly the `pi-memory` collection over the
 * store (its canonical path, used as given), with no `update` hook or model
 * override. Rewritten on every init so a tampered or relocated config heals
 * itself; written via a temp file and rename because sessions sharing a store
 * rewrite it while each other's qmd may be reading it.
 */
export function writeQmdConfig(stateDir: string, store: string): void {
  mkdirSync(stateDir, { recursive: true });
  const config = {
    collections: {
      [COLLECTION]: {
        path: store,
        pattern: "**/*.md",
        context: CONTEXTS,
      },
    },
  };
  const file = path.join(stateDir, "index.yml");
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, stringifyYaml(config));
  renameSync(tmp, file);
}

/**
 * The project-local qmd config qmd would adopt when run from `start`, if any.
 * qmd walks up from its working directory and lets the first `.qmd/index.y(a)ml`
 * override `INDEX_PATH` and `QMD_CONFIG_DIR`.
 */
export function findLocalQmdConfig(start: string): string | undefined {
  let dir = canonicalPath(start);
  for (;;) {
    const found = LOCAL_CONFIG_NAMES.map((name) =>
      path.join(dir, ".qmd", name),
    ).find((file) => existsSync(file));
    if (found) return found;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Removes the qmd state of a session's local stores (shared stores outlive it). */
export function removeSessionQmdState(sessionId: string): void {
  if (sessionId === "." || sessionId === "..") return;
  if (!sessionId || path.basename(sessionId) !== sessionId) return;
  rmSync(path.join(QMD_STATE_ROOT, "sessions", sessionId), {
    recursive: true,
    force: true,
  });
}
