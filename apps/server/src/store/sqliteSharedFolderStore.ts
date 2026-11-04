import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import type { SharedFolder, UserIdentity } from "@tangent/shared/contracts.ts";
import { asc, count, eq } from "drizzle-orm";

import type { Db } from "./db/client.ts";
import { type SharedFolderRow, sharedFolders } from "./db/schema.ts";
import {
  type CreateSharedFolderParams,
  sharedFolderPath,
  type SharedFolderStore,
} from "./sharedFolderStore.ts";

/** Maps a shared_folders row onto the wire {@link SharedFolder}. */
function toSharedFolder(row: SharedFolderRow): SharedFolder {
  return {
    id: row.id,
    name: row.name,
    user: row.userIdentity
      ? (JSON.parse(row.userIdentity) as UserIdentity)
      : undefined,
    createdAt: row.createdAt,
  };
}

/** SQLite-backed {@link SharedFolderStore} over the shared session metadata DB. */
export class SqliteSharedFolderStore implements SharedFolderStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async listSharedFolders(): Promise<SharedFolder[]> {
    const rows = this.db
      .select()
      .from(sharedFolders)
      .orderBy(asc(sharedFolders.createdAt))
      .all();
    return rows.map(toSharedFolder);
  }

  async getSharedFolder(id: string): Promise<SharedFolder | undefined> {
    const row = this.db
      .select()
      .from(sharedFolders)
      .where(eq(sharedFolders.id, id))
      .get();
    return row ? toSharedFolder(row) : undefined;
  }

  async createSharedFolder(
    input: CreateSharedFolderParams,
  ): Promise<SharedFolder> {
    const id = randomUUID();
    const now = new Date().toISOString();

    // The backing directory other sessions symlink to. Created up front so a
    // mount never races a directory that does not exist yet.
    await mkdir(sharedFolderPath(id), { recursive: true });

    const [{ value: existing }] = this.db
      .select({ value: count() })
      .from(sharedFolders)
      .all();

    const folder: SharedFolder = {
      id,
      name: input.name?.trim() || `Shared folder ${existing + 1}`,
      user: input.user,
      createdAt: now,
    };

    this.db
      .insert(sharedFolders)
      .values({
        id: folder.id,
        name: folder.name,
        userIdentity: folder.user ? JSON.stringify(folder.user) : null,
        createdAt: folder.createdAt,
      })
      .run();

    return folder;
  }
}
