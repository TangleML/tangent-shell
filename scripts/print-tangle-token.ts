/**
 * Prints a Tangle cookie token to stdout for use as `TANGLE_TOKEN`.
 *
 * Runs the Oktasso PKCE flow (or reuses the shared on-disk cache) and writes
 * the `OKTASSO_TOKEN=<session>` cookie string — and nothing else — to stdout,
 * so it can be captured directly:
 *
 *   TANGLE_TOKEN="$(pnpm -s tangle:token)" pnpm dev
 *
 * All diagnostics (browser prompt, errors) go to stderr.
 */

import { getOktassoHeaders } from "./oktassoAuth.ts";

const baseUrl =
  process.argv[2] ?? process.env.TANGLE_BASE_URL ?? "https://api.example.com";
const forceRefresh = process.env.TANGLE_TOKEN_FORCE_REFRESH === "1";

try {
  const headers = await getOktassoHeaders({ baseUrl, forceRefresh });
  process.stdout.write(headers.cookie);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
