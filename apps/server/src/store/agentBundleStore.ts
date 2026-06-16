import type { AgentBundleMeta } from "@tangent/shared/contracts.ts";

/**
 * Storage abstraction for the agent bundle marketplace.
 *
 * Bundles are the portable Configuration Bundle ZIPs (see
 * `shared/configBundle.ts`); this store keeps a saved copy plus extracted
 * metadata so the marketplace can list, preview, download, and re-install them.
 * Everything depends on this interface so a persistent backend (object storage,
 * DB, ...) can replace the filesystem implementation without touching routes.
 */
export interface AgentBundleStore {
  /** Lists every saved bundle's metadata, newest first. */
  list(): Promise<AgentBundleMeta[]>;
  /** Returns one bundle's metadata, or `undefined` when it doesn't exist. */
  get(id: string): Promise<AgentBundleMeta | undefined>;
  /**
   * Validates and stores a bundle ZIP, returning its derived metadata. Throws
   * {@link AgentBundleValidationError} on an invalid manifest and
   * {@link AgentBundleConflictError} when the same id + version already exists.
   */
  save(zipBuffer: Buffer): Promise<AgentBundleMeta>;
  /** Removes a stored bundle; resolves `false` when it didn't exist. */
  delete(id: string): Promise<boolean>;
  /** Reads the saved bundle ZIP, or `undefined` when it doesn't exist. */
  readBundle(id: string): Promise<Buffer | undefined>;
  /** Reads the extracted preview icon, or `undefined` when there is none. */
  readIcon(id: string): Promise<Buffer | undefined>;
  /**
   * Reads a bundle's compiled UI component JS by component `name`, or
   * `undefined` when the bundle or component doesn't exist.
   */
  readUiComponent(id: string, name: string): Promise<string | undefined>;
}

/** Raised by {@link AgentBundleStore.save} when the bundle manifest is invalid. */
export class AgentBundleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentBundleValidationError";
  }
}

/**
 * Raised by {@link AgentBundleStore.save} when an identical id + version is
 * already stored, so the route can answer `409` instead of silently
 * overwriting an existing release.
 */
export class AgentBundleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentBundleConflictError";
  }
}
