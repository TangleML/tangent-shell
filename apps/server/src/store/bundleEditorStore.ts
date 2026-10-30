import type { BundleEditor } from "@tangent/shared/contracts.ts";

/**
 * Durable allowlist of users who may upload and delete marketplace agent
 * bundles. Callers pass lowercased emails; the store does not normalize.
 */
export interface BundleEditorStore {
  /** Every editor, oldest first. */
  list(): Promise<BundleEditor[]>;
  has(email: string): Promise<boolean>;
  /** Adds an editor, or returns the existing row when already listed. */
  add(email: string, addedBy: string): Promise<BundleEditor>;
  /** Removes an editor; resolves `false` when it wasn't listed. */
  remove(email: string): Promise<boolean>;
}
