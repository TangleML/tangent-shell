import fs from "node:fs/promises";
import path from "node:path";

import {
  type HostResourceInput,
  MEMORY_AUTHOR,
  type MemoryScope,
} from "@tangent/shared/contracts.ts";

import { UPLOADS_DIRNAME } from "../config.ts";
import { badRequest } from "../middleware/errorHandler.ts";
import type { MemoryManager } from "../pi/memory.ts";
import type { CatalogInput, Resource } from "../store/resourceStore.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import { orchestratorConversationFor } from "./participantRegistry.ts";
import type { ResourceCatalog } from "./resourceCatalog.ts";

/** Everything a host-resource write needs beyond the input. */
export interface ResourceSeedDeps {
  store: SessionStore;
  memory: MemoryManager;
  catalog: ResourceCatalog;
}

/** The catalog entry a memory store stands for, keyed by its scope. */
function memoryResource(sessionId: string, scope: MemoryScope): CatalogInput {
  return {
    sessionId,
    kind: "memory",
    name: scope === "global" ? "Global memory" : "Session memory",
    uri: `memory://${scope}`,
    authorParticipantId: MEMORY_AUTHOR.id,
    meta: { scope },
  };
}

/** The catalog entry a host-provided resource stands for. */
function hostResource(
  sessionId: string,
  input: Extract<HostResourceInput, { kind: "host" }>,
  authorParticipantId: string | undefined,
): CatalogInput {
  return {
    sessionId,
    kind: "host",
    name: input.name,
    uri: input.uri,
    authorParticipantId,
    meta: input.meta,
  };
}

/** Whether `target` lives strictly below the `uploads` directory. */
function withinUploads(uploads: string, target: string): boolean {
  return target.startsWith(uploads + path.sep);
}

/**
 * Resolves `relPath` strictly inside the session's `uploads/` folder, rejecting
 * anything that escapes it or names the folder itself. The authoritative
 * traversal guard (independent of the route's zod refine), so an incoming
 * `file` can never land at the session root and overwrite a system file
 * (`MEMORY.md`, `.tangle/`, the SQLite DB, ...) nor clobber `uploads/` itself.
 */
function resolveWithinUploads(rootPath: string, relPath: string): string {
  const uploads = path.resolve(rootPath, UPLOADS_DIRNAME);
  const target = path.resolve(uploads, relPath);
  if (!withinUploads(uploads, target)) {
    throw badRequest("Resource path must resolve inside the uploads folder");
  }
  return target;
}

/**
 * Writes a `file` resource's bytes under the session's `uploads/` folder,
 * creating nested dirs, and returns its posix session-root-relative uri (always
 * prefixed `uploads/`), matching the workspace-file catalog convention. A write
 * the host's `path` makes impossible (a parent that is itself a file, an
 * invalid name) surfaces as a 400 rather than a raw fs error at 500.
 */
async function writeUploadFile(
  rootPath: string,
  relPath: string,
  content: string,
  encoding: "utf8" | "base64",
): Promise<string> {
  const target = resolveWithinUploads(rootPath, relPath);
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(content, encoding));
  } catch {
    throw badRequest("Could not write the resource file at the given path");
  }
  return path.relative(rootPath, target).split(path.sep).join("/");
}

/** The catalog entry a written host `file` stands for, keyed by its uri. */
function fileResource(
  sessionId: string,
  uri: string,
  input: Extract<HostResourceInput, { kind: "file" }>,
  authorParticipantId: string | undefined,
): CatalogInput {
  return {
    sessionId,
    kind: "file",
    name: input.name ?? path.posix.basename(uri),
    uri,
    authorParticipantId,
    meta: input.meta,
  };
}

/** The memory scope a `memory://` uri names, or null for any other uri. */
export function memoryScopeFromUri(uri: string): MemoryScope | null {
  if (uri === "memory://session") return "session";
  if (uri === "memory://global") return "global";
  return null;
}

/**
 * Applies one host-provided resource to a session: writes the memory store (for
 * a `memory` input, so the file the agent reads is the write authority), writes
 * the bytes under `uploads/` (for a `file` input), and references the entry into
 * the orchestrator's Conversation so it surfaces. Returns the catalog entry;
 * idempotent per uri.
 */
export async function applyResourceInput(
  deps: ResourceSeedDeps,
  sessionId: string,
  rootPath: string,
  input: HostResourceInput,
  authorParticipantId?: string,
): Promise<Resource> {
  const conversationId = await orchestratorConversationFor(
    deps.store,
    sessionId,
  );
  if (input.kind === "memory") {
    const scope = input.scope ?? "session";
    deps.memory.write(rootPath, scope, input.content);
    return deps.catalog.catalogIn(
      conversationId,
      memoryResource(sessionId, scope),
    );
  }
  if (input.kind === "file") {
    const uri = await writeUploadFile(
      rootPath,
      input.path,
      input.content,
      input.encoding ?? "utf8",
    );
    return deps.catalog.catalogIn(
      conversationId,
      fileResource(sessionId, uri, input, authorParticipantId),
    );
  }
  return deps.catalog.catalogIn(
    conversationId,
    hostResource(sessionId, input, authorParticipantId),
  );
}

/**
 * Deletes the on-disk bytes a host `file` resource stands for, so the workspace
 * rescan (`catalogWorkspaceFiles`, run on every list) cannot re-catalog an entry
 * the host just removed. A no-op for any other kind, and for a uri that does not
 * resolve strictly inside `uploads/` — human attachments and agent artifacts
 * keep their own lifecycle. Runs before the catalog row is dropped so a failed
 * unlink never leaves a dangling row for the rescan to resurrect.
 */
async function unlinkManagedFile(
  deps: ResourceSeedDeps,
  sessionId: string,
  rootPath: string,
  uri: string,
): Promise<void> {
  const resources = await deps.catalog.listForSession(sessionId);
  const row = resources.find((resource) => resource.uri === uri);
  if (row?.kind !== "file") return;
  const uploads = path.resolve(rootPath, UPLOADS_DIRNAME);
  const target = path.resolve(rootPath, uri);
  if (!withinUploads(uploads, target)) return;
  await fs.rm(target, { force: true });
}

/**
 * Removes a catalogued resource by uri, cascading its references. Removing a
 * memory store's entry also empties the store, so `read_memory` and the catalog
 * agree; removing a host `file` also deletes its bytes so the workspace rescan
 * can't resurrect it.
 */
export async function removeResourceByUri(
  deps: ResourceSeedDeps,
  sessionId: string,
  rootPath: string,
  uri: string,
): Promise<void> {
  await unlinkManagedFile(deps, sessionId, rootPath, uri);
  await deps.catalog.remove(sessionId, uri);
  const scope = memoryScopeFromUri(uri);
  if (scope) deps.memory.clear(rootPath, scope);
}
