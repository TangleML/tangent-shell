/**
 * Loads a `.env` (or `sso.config` fallback) so the client's `OKTASSO_*` config
 * is populated. Import this for its side effects *before* any module that reads
 * those variables.
 *
 * A packaged (zipped) skill is self-contained: the file sits next to the bundle
 * and is found via `import.meta.url`, so it works wherever the zip is extracted.
 * Running from source in the monorepo there is no bundle-adjacent file, so the
 * search also walks up from the cwd to find a repo-root `.env` — this matters
 * because `pnpm --filter <pkg> exec` runs with the cwd set to the package dir,
 * not the repo root.
 *
 * The first file that exists wins; `.env` is checked before `sso.config`, which
 * exists so config survives distribution channels that strip `.env`. Variables
 * already set in the real environment take precedence and are never overwritten.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const bundleDir = path.dirname(fileURLToPath(import.meta.url));

/** `dir` and each of its ancestors, up to the filesystem root. */
function ancestors(dir: string): string[] {
  const out: string[] = [];
  let current = path.resolve(dir);
  for (;;) {
    out.push(current);
    const parent = path.dirname(current);
    if (parent === current) return out;
    current = parent;
  }
}

const searchDirs = [
  bundleDir,
  path.join(bundleDir, ".."),
  ...ancestors(process.cwd()),
];

const candidates = [
  ...searchDirs.map((dir) => path.join(dir, ".env")),
  ...searchDirs.map((dir) => path.join(dir, "sso.config")),
];

for (const candidate of candidates) {
  try {
    process.loadEnvFile(candidate);
    break;
  } catch {
    // Missing or unreadable — try the next candidate.
  }
}
