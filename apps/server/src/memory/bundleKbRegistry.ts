import { readdirSync } from "node:fs";
import path from "node:path";

import { BUNDLE_MEMORY_ROOT } from "../config.ts";
import { BundleKbStore } from "./bundleKbStore.ts";
import { QmdIndexer, QmdRunner } from "./qmdRunner.ts";

/** The bundle manifest id rule; also keeps the id a single path segment. */
const STORE_ID = /^[a-z0-9][a-z0-9-]*$/;

export interface BundleKbRegistryOptions {
  root?: string;
  runner?: QmdRunner;
  debounceMs?: number;
}

/**
 * Owns one {@link BundleKbStore} per bundle manifest id under
 * {@link BUNDLE_MEMORY_ROOT}, so every session of a bundle shares the same store
 * object, plus the qmd runner and the indexer that keeps their indexes fresh.
 */
export class BundleKbRegistry {
  readonly runner: QmdRunner;
  readonly indexer: QmdIndexer;
  private readonly root: string;
  private readonly stores = new Map<string, BundleKbStore>();

  constructor(options: BundleKbRegistryOptions = {}) {
    this.root = options.root ?? BUNDLE_MEMORY_ROOT;
    this.runner = options.runner ?? new QmdRunner();
    this.indexer = new QmdIndexer(this.runner, options.debounceMs);
  }

  /** @throws when `manifestId` is not a valid bundle id */
  get(manifestId: string): BundleKbStore {
    if (!STORE_ID.test(manifestId)) {
      throw new Error(`[memory] "${manifestId}" is not a bundle id`);
    }
    let store = this.stores.get(manifestId);
    if (!store) {
      store = new BundleKbStore(manifestId, path.join(this.root, manifestId));
      this.stores.set(manifestId, store);
    }
    return store;
  }

  /** Reindexes `store` once its writes settle. */
  scheduleReindex(store: BundleKbStore): void {
    this.indexer.schedule(store.stateDir);
  }

  /** Re-registers every existing store's qmd config and queues a reindex. */
  reindexAll(): Promise<void> {
    for (const id of this.storeIds()) {
      const store = this.get(id);
      try {
        store.ensure();
        void this.indexer.enqueue(store.stateDir);
      } catch (err) {
        console.error(`[memory] failed to prepare bundle store ${id}:`, err);
      }
    }
    return this.indexer.idle();
  }

  private storeIds(): string[] {
    try {
      return readdirSync(this.root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && STORE_ID.test(entry.name))
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }
}
