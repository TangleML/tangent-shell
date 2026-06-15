import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { SESSIONS_DB } from "../../config.ts";
import * as schema from "./schema.ts";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Opens the SQLite database at {@link SESSIONS_DB}, applies pending drizzle-kit
 * migrations, and returns a typed Drizzle client.
 *
 * - `journal_mode = WAL` for better concurrent read/write behavior.
 * - `foreign_keys = ON` so the `ON DELETE CASCADE` relations actually fire.
 *
 * The migrations folder is resolved relative to this module so the same code
 * works both in dev (`server/src/store/db/migrations`) and in the bundled
 * server (`dist/migrations`, copied by `server/build.mjs`).
 */
export function openDb(file: string = SESSIONS_DB): Db {
  mkdirSync(path.dirname(file), { recursive: true });

  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  const migrationsFolder = fileURLToPath(
    new URL("./migrations", import.meta.url),
  );
  migrate(db, { migrationsFolder });

  return db;
}
