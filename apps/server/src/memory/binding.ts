import { statSync } from "node:fs";
import path from "node:path";

import type { MemoryBinding, Resource } from "@tangent/shared/contracts.ts";

import { sharedFolderPath } from "../store/sharedFolderStore.ts";
import { canonicalPath, isStrictlyInside } from "./paths.ts";
import { piMemoryInstalled } from "./piMemory.ts";

/** Default session-local directory for a `pi-memory` leaf with no `root`. */
export const DEFAULT_PI_MEMORY_DIR = ".pi-memory";

export type PiMemoryBinding = Extract<MemoryBinding, { kind: "pi-memory" }>;

/** Backing directories of the shared folders a session's catalog has mounted. */
export function mountedFolderPaths(resources: readonly Resource[]): string[] {
  return resources.flatMap((resource) => {
    const id = resource.meta?.sharedFolderId;
    if (resource.kind !== "mount" || typeof id !== "string") return [];
    return [sharedFolderPath(id)];
  });
}

/**
 * Resolves a binding's session-root-relative `root` into the canonical directory
 * it names, strictly inside the (absolute) session root `base`. A `root`
 * pointing at a mounted shared folder (`<mountName>` or `<mountName>/...`, the
 * mount itself a symlink under the root) shares the store; the guard rejects
 * traversal/absolute paths that would escape the session root, and the session
 * root itself, whose `MEMORY.md` is SimpleMD's session memory. Symlinks are then
 * resolved and the real path must be one of `mountedFolders`, or sit inside one
 * or inside the session root, so a re-pointed mount or a link planted in a
 * folder can't redirect the store into another session or an unmounted folder.
 * Callers keep the returned path rather than re-resolving it, so a later relink
 * can't move the store either.
 */
export function resolveRoot(
  base: string,
  rel: string,
  mountedFolders: readonly string[],
): string {
  const resolved = path.resolve(base, rel);
  if (resolved === base) {
    throw new Error(
      `[memory] binding root "${rel}" is the session root itself; ignoring`,
    );
  }
  if (!isStrictlyInside(resolved, base)) {
    throw new Error(
      `[memory] binding root "${rel}" escapes the session root; ignoring`,
    );
  }
  // Bindings stored before the schema rejected it; see manifest.ts storeRoot.
  if (path.relative(base, resolved).split(path.sep).includes(".qmd")) {
    throw new Error(
      `[memory] binding root "${rel}" has a .qmd segment, which qmd would treat as its own config dir; ignoring`,
    );
  }
  const real = canonicalPath(resolved);
  const inMount = mountedFolders
    .map(canonicalPath)
    .some((mount) => real === mount || isStrictlyInside(real, mount));
  if (!inMount && !isStrictlyInside(real, canonicalPath(base))) {
    throw new Error(
      `[memory] binding root "${rel}" resolves through a symlink to ${real}, outside the session and its mounted folders; ignoring`,
    );
  }
  return real;
}

/**
 * True when a binding `root` can be used: pi-memory's default session-local
 * directory (created on demand), or a root whose top-level entry is an existing
 * directory — a mounted shared folder. The stat follows symlinks, so a dangling mount is
 * unavailable. A missing top-level is never created: it would occupy a mount
 * name.
 */
export function storeAvailable(base: string, rel: string): boolean {
  const [top] = path.normalize(rel).split(path.sep).filter(Boolean);
  if (top === DEFAULT_PI_MEMORY_DIR) return true;
  try {
    return statSync(path.join(base, top)).isDirectory();
  } catch {
    return false;
  }
}

/** Number of `pi-memory` leaves anywhere in a binding tree. */
export function countPiMemoryLeaves(binding: MemoryBinding): number {
  if (binding.kind === "pi-memory") return 1;
  if (binding.kind === "simple-md") return 0;
  return binding.children.reduce(
    (count, child) => count + countPiMemoryLeaves(child),
    0,
  );
}

/**
 * A pi-memory leaf's usable store under the absolute session root `base` — its
 * canonical `dir` and the session-root-relative `label` shown to agents — or
 * the `reason` it can't be used.
 */
export function checkPiMemoryStore(
  binding: PiMemoryBinding,
  base: string,
  mountedFolders: readonly string[],
): { dir: string; label: string } | { reason: string } {
  const rel = binding.root ?? DEFAULT_PI_MEMORY_DIR;
  let dir: string;
  try {
    dir = resolveRoot(base, rel, mountedFolders);
  } catch (err) {
    return { reason: err instanceof Error ? err.message : String(err) };
  }
  if (!storeAvailable(base, rel)) {
    return { reason: `root "${rel}" is not an existing folder` };
  }
  if (!piMemoryInstalled()) {
    return { reason: "the pi-memory package is not installed" };
  }
  return { dir, label: path.relative(base, path.resolve(base, rel)) };
}

/** A `simple-md` leaf kept at creation: rootless, or rooted in an existing folder. */
function settleSharedNote(
  binding: Extract<MemoryBinding, { kind: "simple-md" }>,
  base: string,
  sessionId: string,
): MemoryBinding | undefined {
  if (!binding.root || storeAvailable(base, binding.root)) return binding;
  console.warn(
    `[memory] session ${sessionId}: dropping simple-md note (root "${binding.root}" is not an existing folder); the session uses SimpleMD only`,
  );
  return undefined;
}

function settleNode(
  binding: MemoryBinding,
  base: string,
  sessionId: string,
  mountedFolders: readonly string[],
): MemoryBinding | undefined {
  if (binding.kind === "simple-md") {
    return settleSharedNote(binding, base, sessionId);
  }
  if (binding.kind === "pi-memory") {
    const store = checkPiMemoryStore(binding, base, mountedFolders);
    if (!("reason" in store)) return binding;
    console.warn(
      `[memory] session ${sessionId}: dropping pi-memory (${store.reason}); the session uses SimpleMD only`,
    );
    return undefined;
  }
  const children = binding.children
    .map((child) => settleNode(child, base, sessionId, mountedFolders))
    .filter((child): child is MemoryBinding => child !== undefined);
  return children.length > 0 ? { kind: "composite", children } : undefined;
}

/**
 * The binding a new session keeps, decided once at creation (after its seed
 * mounts exist): each `pi-memory` or rooted `simple-md` leaf whose store isn't
 * available is dropped, so the session stays SimpleMD-only for its lifetime
 * instead of picking the store up (or creating it at a mount name) later.
 */
export function settleBinding(
  binding: MemoryBinding | undefined,
  sessionId: string,
  rootPath: string,
  mountedFolders: readonly string[],
): MemoryBinding | undefined {
  if (!binding) return undefined;
  return settleNode(binding, path.resolve(rootPath), sessionId, mountedFolders);
}
