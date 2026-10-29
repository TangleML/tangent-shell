import fs from "node:fs/promises";
import path from "node:path";

import {
  type HostResourceInput,
  MEMORY_AUTHOR,
  type MemoryScope,
  type SharedFolder,
} from "@tangent/shared/contracts.ts";

import {
  ARTIFACTS_DIRNAME,
  GLOBAL_MEMORY_FILENAME,
  MAX_FILE_RESOURCE_BYTES,
  SESSION_MEMORY_FILENAME,
  UPLOADS_DIRNAME,
} from "../config.ts";
import { badRequest } from "../middleware/errorHandler.ts";
import type { MemoryManager } from "../pi/memory.ts";
import { isWithin } from "../routes/sessions/utils.ts";
import type { CatalogInput, Resource } from "../store/resourceStore.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import {
  sharedFolderPath,
  type SharedFolderStore,
} from "../store/sharedFolderStore.ts";
import { orchestratorConversationFor } from "./participantRegistry.ts";
import type { ResourceCatalog } from "./resourceCatalog.ts";

/** Everything a host-resource write needs beyond the input. */
export interface ResourceSeedDeps {
  store: SessionStore;
  memory: MemoryManager;
  catalog: ResourceCatalog;
  /** Resolves the shared folder a `mount` input symlinks into the session. */
  sharedFolders: SharedFolderStore;
}

/**
 * Names a mount symlink may not take at the session root — the files and folders
 * the session provisions and serves — so a mount can never shadow `.tangent/`,
 * the memory files, or the HTTP-served subtrees.
 */
const RESERVED_MOUNT_NAMES = new Set([
  ARTIFACTS_DIRNAME,
  UPLOADS_DIRNAME,
  ".tangent",
  "AGENTS.md",
  SESSION_MEMORY_FILENAME,
  GLOBAL_MEMORY_FILENAME,
]);

/** A single, traversal-free path segment derived from a shared folder's name. */
function sanitizeMountName(name: string): string {
  const base = path.basename(name).replace(/[/\\]/g, "_");
  const cleaned = base.replace(/^\.+/, "").trim();
  return cleaned || "shared";
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

/** The catalog entry a mounted shared folder stands for, keyed by its uri. */
function mountResource(
  sessionId: string,
  folder: SharedFolder,
  mountName: string,
  authorParticipantId: string | undefined,
): CatalogInput {
  return {
    sessionId,
    kind: "mount",
    name: folder.name,
    uri: `mount://${folder.id}`,
    authorParticipantId,
    meta: {
      sharedFolderId: folder.id,
      mountName,
      target: sharedFolderPath(folder.id),
    },
  };
}

/**
 * Creates the symlink that mounts a shared folder at `mountName` under the
 * session root. Idempotent: a link already pointing at `target` is left as-is,
 * so re-applying the same mount is a no-op; a different file or folder already
 * occupying the name is a 400 rather than a silent overwrite.
 */
async function createMountSymlink(
  rootPath: string,
  mountName: string,
  target: string,
): Promise<void> {
  const linkPath = path.join(rootPath, mountName);
  const existing = await fs.lstat(linkPath).catch(() => null);
  if (existing) {
    if (existing.isSymbolicLink()) {
      const current = await fs.readlink(linkPath).catch(() => null);
      if (current === target) return;
    }
    throw badRequest("A file or folder already exists at the mount name");
  }
  await fs.symlink(target, linkPath, "dir");
}

/**
 * Resolves a shared folder and symlinks it into the session root, returning the
 * mount name used. Reuses an existing mount's name so re-applying never spawns a
 * second link under a different name; rejects an unknown folder or a reserved
 * name with a 400.
 */
async function mountSharedFolder(
  deps: ResourceSeedDeps,
  sessionId: string,
  rootPath: string,
  folder: SharedFolder,
  requestedName: string | undefined,
): Promise<string> {
  const uri = `mount://${folder.id}`;
  const resources = await deps.catalog.listForSession(sessionId);
  const existing = resources.find((resource) => resource.uri === uri);
  const mountName =
    (existing?.meta?.mountName as string | undefined) ??
    requestedName ??
    sanitizeMountName(folder.name);
  if (RESERVED_MOUNT_NAMES.has(mountName)) {
    throw badRequest(`"${mountName}" is a reserved name; choose another`);
  }
  await createMountSymlink(rootPath, mountName, sharedFolderPath(folder.id));
  return mountName;
}

/**
 * Mounts a shared folder into the session (symlink) and catalogs the `mount`
 * entry in the orchestrator's Conversation. Rejects an unknown folder with a 400.
 */
async function applyMount(
  deps: ResourceSeedDeps,
  sessionId: string,
  rootPath: string,
  conversationId: string,
  input: Extract<HostResourceInput, { kind: "mount" }>,
  authorParticipantId: string | undefined,
): Promise<Resource> {
  const folder = await deps.sharedFolders.getSharedFolder(input.folderId);
  if (!folder) throw badRequest("Unknown shared folder");
  const mountName = await mountSharedFolder(
    deps,
    sessionId,
    rootPath,
    folder,
    input.mountName,
  );
  return deps.catalog.catalogIn(
    conversationId,
    mountResource(sessionId, folder, mountName, authorParticipantId),
  );
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
  if (input.kind === "mount") {
    return applyMount(
      deps,
      sessionId,
      rootPath,
      conversationId,
      input,
      authorParticipantId,
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
 * can't resurrect it. A `mount` entry is one-way: dropping its row leaves the
 * symlink in place, so the agent keeps its access to the shared folder.
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

/** A session resource file's bytes (base64) and the content type its uri implies. */
export interface SessionResourceFile {
  content: string;
  contentType: string;
}

/** Content types a resource read derives from a file extension, else octet-stream. */
const CONTENT_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

/** The content type a resource uri implies, by extension; octet-stream by default. */
function contentTypeFor(uri: string): string {
  return (
    CONTENT_TYPES[path.extname(uri).toLowerCase()] ?? "application/octet-stream"
  );
}

/**
 * Reads one session resource's bytes by its session-root-relative uri. The uri
 * is resolved strictly inside the session root's `uploads/` or `artifacts/`
 * subtree and the payload is capped at {@link MAX_FILE_RESOURCE_BYTES}. Returns
 * the base64 content and derived content type; a bad uri, a missing file, or an
 * oversized payload surface as a 400. Shared by the remote-env gateway and the
 * attach route so an agent on another environment can fetch what a local one
 * contributed.
 */
export async function readSessionResourceFile(
  rootPath: string,
  uri: string,
): Promise<SessionResourceFile> {
  const target = path.resolve(rootPath, uri);
  const uploads = path.join(rootPath, UPLOADS_DIRNAME);
  const artifacts = path.join(rootPath, ARTIFACTS_DIRNAME);
  if (!isWithin(target, uploads) && !isWithin(target, artifacts)) {
    throw badRequest("Resource uri is outside the session.");
  }
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    throw badRequest("Resource not found.");
  }
  if (stat.size > MAX_FILE_RESOURCE_BYTES) {
    throw badRequest("Resource is too large to read.");
  }
  try {
    const bytes = await fs.readFile(target);
    return {
      content: bytes.toString("base64"),
      contentType: contentTypeFor(uri),
    };
  } catch {
    throw badRequest("Resource not found.");
  }
}
