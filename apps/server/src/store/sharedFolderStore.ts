import path from "node:path";

import type { SharedFolder, UserIdentity } from "@tangent/shared/contracts.ts";

import { SHARED_ROOT } from "../config.ts";

/** Absolute path to a shared folder's backing directory under `SHARED_ROOT`. */
export function sharedFolderPath(id: string): string {
  return path.join(SHARED_ROOT, id);
}

/**
 * Input accepted by {@link SharedFolderStore.createSharedFolder}: the public
 * wire request plus the server-resolved {@link UserIdentity} (from the creator's
 * Oktasso JWT), which is never part of the client-supplied body.
 */
export interface CreateSharedFolderParams {
  name?: string;
  user?: UserIdentity;
}

/**
 * Storage abstraction for shared folders — the cross-session "project" folders a
 * session mounts into its root by symlink. Their bytes live under `SHARED_ROOT`;
 * this table holds only their metadata. Kept apart from
 * {@link import("./sessionStore.ts").SessionStore} because a shared folder
 * outlives any one session and is not session-scoped.
 */
export interface SharedFolderStore {
  listSharedFolders(): Promise<SharedFolder[]>;
  getSharedFolder(id: string): Promise<SharedFolder | undefined>;
  /** Creates the folder's metadata row and its backing directory on disk. */
  createSharedFolder(input: CreateSharedFolderParams): Promise<SharedFolder>;
}
