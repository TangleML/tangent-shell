/**
 * Loads the repo-root `.env` (if present) and validates the internal Minerva
 * config. Import this for its side effects *before* any module that reads the
 * `MINERVA_*` variables at top level, so the values are populated in time.
 *
 * `.env` is gitignored; see `.env.example` for the expected keys. Variables
 * already present in the real environment take precedence and are never
 * overwritten by the file.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  // No .env file — fine as long as the variables are set in the environment.
}

const REQUIRED = [
  "MINERVA_OAUTH_ENDPOINT_BASE",
  "MINERVA_TOKEN_EXCHANGE_URL",
  "MINERVA_SCOPES",
  "MINERVA_CLIENT_ID",
  "MINERVA_REDIRECT_URI",
  "MINERVA_CALLBACK_PORT",
  "MINERVA_REFRESH_AFTER_MS",
] as const;

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `[minervaAuth] missing required config: ${missing.join(", ")}.\n` +
      `Copy .env.example to .env at the repo root and fill in the values.`,
  );
  process.exit(1);
}
