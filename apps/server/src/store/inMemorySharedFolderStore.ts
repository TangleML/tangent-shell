import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import type { SharedFolder } from "@tangent/shared/contracts.ts";

import {
  type CreateSharedFolderParams,
  sharedFolderPath,
  type SharedFolderStore,
} from "./sharedFolderStore.ts";

/**
 * Process-local {@link SharedFolderStore} for tests, mirroring
 * {@link import("./inMemoryResourceStore.ts").InMemoryResourceStore}. Still
 * creates each folder's backing directory on disk (under `SHARED_ROOT`) so a
 * mount's symlink has a real target.
 */
export class InMemorySharedFolderStore implements SharedFolderStore {
  private readonly byId = new Map<string, SharedFolder>();

  async listSharedFolders(): Promise<SharedFolder[]> {
    return [...this.byId.values()];
  }

  async getSharedFolder(id: string): Promise<SharedFolder | undefined> {
    return this.byId.get(id);
  }

  async createSharedFolder(
    input: CreateSharedFolderParams,
  ): Promise<SharedFolder> {
    const id = randomUUID();
    await mkdir(sharedFolderPath(id), { recursive: true });
    const folder: SharedFolder = {
      id,
      name: input.name?.trim() || `Shared folder ${this.byId.size + 1}`,
      user: input.user,
      createdAt: new Date().toISOString(),
    };
    this.byId.set(id, folder);
    return folder;
  }
}
