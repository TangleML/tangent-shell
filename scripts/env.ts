/**
 * Loads the repo-root `.env` (if present) and validates the Oktasso
 * config. Import this for its side effects *before* any module that reads the
 * `OKTASSO_*` variables at top level, so the values are populated in time.
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
  "OKTASSO_OAUTH_ENDPOINT_BASE",
  "OKTASSO_TOKEN_EXCHANGE_URL",
  "OKTASSO_SCOPES",
  "OKTASSO_CLIENT_ID",
  "OKTASSO_REDIRECT_URI",
  "OKTASSO_CALLBACK_PORT",
  "OKTASSO_REFRESH_AFTER_MS",
] as const;

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `[oktassoAuth] missing required config: ${missing.join(", ")}.\n` +
      `Copy .env.example to .env at the repo root and fill in the values.`,
  );
  process.exit(1);
}
