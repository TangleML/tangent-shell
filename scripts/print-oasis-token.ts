/**
 * Prints an Oasis cookie token to stdout for use as `OASIS_TOKEN`.
 *
 * Runs the Minerva PKCE flow (or reuses the shared on-disk cache) and writes
 * the `MINERVA_TOKEN=<session>` cookie string — and nothing else — to stdout,
 * so it can be captured directly:
 *
 *   OASIS_TOKEN="$(pnpm -s oasis:token)" pnpm dev
 *
 * All diagnostics (browser prompt, errors) go to stderr.
 */

import { getMinervaHeaders } from "./minervaAuth.ts";

const baseUrl =
  process.argv[2] ?? process.env.OASIS_BASE_URL ?? "https://oasis.shopify.io";
const forceRefresh = process.env.OASIS_TOKEN_FORCE_REFRESH === "1";

try {
  const headers = await getMinervaHeaders({ baseUrl, forceRefresh });
  process.stdout.write(headers.cookie);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
