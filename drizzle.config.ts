import path from "node:path";

import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration for the session metadata DB.
 *
 * `db:generate` reads the schema and emits versioned SQL migrations (committed
 * under `server/src/store/db/migrations`). The migrations are applied at server
 * startup by `openDb()` in `server/src/store/db/client.ts`; `db:migrate` is
 * available for manual/CI application against `SESSIONS_DB`.
 */
const dbUrl =
  process.env.SESSIONS_DB ??
  path.resolve(process.cwd(), ".sessions", "tangent.db");

export default defineConfig({
  dialect: "sqlite",
  schema: "./server/src/store/db/schema.ts",
  out: "./server/src/store/db/migrations",
  dbCredentials: { url: dbUrl },
});
