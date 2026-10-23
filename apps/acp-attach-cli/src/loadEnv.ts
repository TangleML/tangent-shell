/**
 * Loads a `.env` (or `sso.config` fallback) bundled next to the client so a
 * packaged (zipped) skill is self-contained. Import this for its side effects
 * *before* any module that reads the `OKTASSO_*` variables, so the values are
 * populated in time.
 *
 * Candidates are resolved relative to the bundle (via `import.meta.url`), not
 * the cwd, so it works wherever the zip is extracted. The first file that
 * exists wins; `.env` is checked before `sso.config`, which exists so config
 * survives distribution channels that strip `.env`. Variables already set in
 * the real environment take precedence and are never overwritten by the file.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const bundleDir = path.dirname(fileURLToPath(import.meta.url));

const candidates = [
  path.join(bundleDir, ".env"),
  path.join(bundleDir, "..", ".env"),
  path.join(process.cwd(), ".env"),
  path.join(bundleDir, "sso.config"),
  path.join(bundleDir, "..", "sso.config"),
  path.join(process.cwd(), "sso.config"),
];

for (const candidate of candidates) {
  try {
    process.loadEnvFile(candidate);
    break;
  } catch {
    // Missing or unreadable — try the next candidate.
  }
}
