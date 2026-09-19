/**
 * Prints a Tangle cookie token to stdout for use as `TANGLE_TOKEN`.
 *
 * Runs the Oktasso PKCE flow (or reuses the shared on-disk cache) and writes
 * the `OKTASSO_TOKEN=<session>` cookie string — and nothing else — to stdout,
 * so it can be captured directly:
 *
 *   TANGLE_TOKEN="$(pnpm -s tangle:token)" pnpm dev
 *
 * Pass `jwt-only` as the first argument to strip the cookie-name prefix and
 * emit the bare token value (e.g. for `MINERVA_TOKEN`):
 *
 *   MINERVA_TOKEN="$(pnpm -s tangle:token jwt-only https://oasis-staging.shopify.io)"
 *
 * All diagnostics (browser prompt, errors) go to stderr.
 */

import { getOktassoHeaders } from "./oktassoAuth.ts";

const jwtOnly = process.argv[2] === "jwt-only";
const urlArg = jwtOnly ? process.argv[3] : process.argv[2];
const baseUrl =
  urlArg ?? process.env.TANGLE_BASE_URL ?? "https://api.example.com";
const forceRefresh = process.env.TANGLE_TOKEN_FORCE_REFRESH === "1";

try {
  const headers = await getOktassoHeaders({ baseUrl, forceRefresh });
  const eq = headers.cookie.indexOf("=");
  const bareToken = eq === -1 ? headers.cookie : headers.cookie.slice(eq + 1);
  process.stdout.write(jwtOnly ? bareToken : headers.cookie);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
