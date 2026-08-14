import fs from "node:fs/promises";
import path from "node:path";

import { ARTIFACTS_DIRNAME, UPLOADS_DIRNAME } from "../config.ts";
import type { ResourceCatalog } from "./resourceCatalog.ts";

/** The session-root subtrees a workspace file is served from and catalogued in. */
const SCANNED_DIRS = [ARTIFACTS_DIRNAME, UPLOADS_DIRNAME];

/** Recursively collects every regular file under `dir`, absolute paths. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await fs
    .readdir(dir, { withFileTypes: true })
    .catch(() => []);
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return filesUnder(full);
      if (entry.isFile()) return Promise.resolve([full]);
      return Promise.resolve([]);
    }),
  );
  return nested.flat();
}

/**
 * Catalogs the session's workspace files (under `artifacts/` and `uploads/`) as
 * `file` {@link import("@tangent/shared/contracts.ts").Resource}s, so content an
 * agent produced on disk is citable content like a pinned artifact is. Uses
 * insert-if-absent so a path already catalogued as an `artifact` or `attachment`
 * keeps its kind — the pin/attachment mechanisms stay authoritative for those.
 *
 * Files are session-scoped and tied to no thread, so they are catalogued but not
 * referenced into a Conversation. Called on the read path (scan-then-list), not
 * from a background watcher.
 */
export async function catalogWorkspaceFiles(
  catalog: ResourceCatalog,
  session: { id: string; rootPath: string },
): Promise<void> {
  const roots = SCANNED_DIRS.map((dir) => path.join(session.rootPath, dir));
  const found = (await Promise.all(roots.map(filesUnder))).flat();
  await Promise.all(
    found.map(async (absolute) => {
      const uri = path
        .relative(session.rootPath, absolute)
        .split(path.sep)
        .join("/");
      await catalog.catalogIfAbsent({
        sessionId: session.id,
        kind: "file",
        name: path.basename(absolute),
        uri,
      });
    }),
  );
}
