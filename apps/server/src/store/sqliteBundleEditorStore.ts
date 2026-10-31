import type { BundleEditor } from "@tangent/shared/contracts.ts";
import { asc, eq } from "drizzle-orm";

import type { BundleEditorStore } from "./bundleEditorStore.ts";
import type { Db } from "./db/client.ts";
import { type BundleEditorRow, bundleEditors } from "./db/schema.ts";

function toBundleEditor(row: BundleEditorRow): BundleEditor {
  return {
    email: row.email,
    addedBy: row.addedBy,
    createdAt: row.createdAt,
  };
}

/** SQLite-backed {@link BundleEditorStore} over the shared metadata DB. */
export class SqliteBundleEditorStore implements BundleEditorStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async list(): Promise<BundleEditor[]> {
    const rows = this.db
      .select()
      .from(bundleEditors)
      .orderBy(asc(bundleEditors.createdAt))
      .all();
    return rows.map(toBundleEditor);
  }

  async has(email: string): Promise<boolean> {
    const row = this.db
      .select({ email: bundleEditors.email })
      .from(bundleEditors)
      .where(eq(bundleEditors.email, email))
      .get();
    return row !== undefined;
  }

  async add(email: string, addedBy: string): Promise<BundleEditor> {
    this.db
      .insert(bundleEditors)
      .values({ email, addedBy, createdAt: new Date().toISOString() })
      .onConflictDoNothing()
      .run();
    const row = this.db
      .select()
      .from(bundleEditors)
      .where(eq(bundleEditors.email, email))
      .get();
    if (!row) throw new Error(`Failed to store bundle editor ${email}`);
    return toBundleEditor(row);
  }

  async remove(email: string): Promise<boolean> {
    const result = this.db
      .delete(bundleEditors)
      .where(eq(bundleEditors.email, email))
      .run();
    return result.changes > 0;
  }
}
