/**
 * Packs the tangent-acp-attach skill into a self-contained zip.
 *
 * Expects `esbuild.mjs` to have run first (the root `package` script chains
 * them). Reads the repo-root `.env`, keeps only the keys the client reads for
 * Oktasso auth, writes that vendored config into the skill dir as both `.env`
 * and `sso.config`, and zips the SKILL.md, the bundled client, and both config
 * files into `tangent-acp-attach.zip`.
 *
 * The vendored config lets the extracted skill authenticate out of the box;
 * `sso.config` is a fallback for distribution channels that strip `.env`. Real
 * environment variables still override it, and `.env` overrides `sso.config` at
 * runtime (see src/loadEnv.ts).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const skillDir = resolve(repoRoot, ".claude/skills/tangent-acp-attach");

// The only variables the client reads for Oktasso auth. Unrelated secrets
// (REMOTE_ENV_TOKEN, PI_PROXY_API_KEY, TANGLE_*, ...) are deliberately dropped.
const VENDORED_KEYS = new Set([
  "OKTASSO_OAUTH_ENDPOINT_BASE",
  "OKTASSO_TOKEN_EXCHANGE_URL",
  "OKTASSO_CLIENT_ID",
  "OKTASSO_SCOPES",
  "OKTASSO_REDIRECT_URI",
  "OKTASSO_CALLBACK_PORT",
  "OKTASSO_REFRESH_AFTER_MS",
  "AUTH_JWT_TOKEN_COOKIE_NAME",
]);

/** The repo-root `.env` lines for the vendored keys, preserving quoting. */
function vendoredEnv() {
  const raw = readFileSync(resolve(repoRoot, ".env"), "utf8");
  const kept = raw
    .split("\n")
    .filter((line) => {
      const match = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
      return match ? VENDORED_KEYS.has(match[1]) : false;
    })
    .map((line) => line.trim());

  const found = new Set(
    kept.map((line) => /^([A-Z0-9_]+)/.exec(line)?.[1]).filter(Boolean),
  );
  const missing = [...VENDORED_KEYS].filter((key) => !found.has(key));
  if (missing.length > 0) {
    throw new Error(
      `repo .env is missing keys needed by the skill: ${missing.join(", ")}`,
    );
  }
  return `${kept.join("\n")}\n`;
}

const env = vendoredEnv();
writeFileSync(resolve(skillDir, ".env"), env);
writeFileSync(resolve(skillDir, "sso.config"), env);

const bundle = readFileSync(
  resolve(skillDir, "scripts/tangent-acp-attach.mjs"),
);
const skillMd = readFileSync(resolve(skillDir, "SKILL.md"));

// Fixed mtime keeps repacks byte-identical; fflate adds no __MACOSX junk.
const files = {
  "SKILL.md": new Uint8Array(skillMd),
  "scripts/tangent-acp-attach.mjs": new Uint8Array(bundle),
  ".env": new Uint8Array(Buffer.from(env)),
  "sso.config": new Uint8Array(Buffer.from(env)),
};
const zipped = zipSync(files, { mtime: new Date(2020, 0, 1, 12) });

const outPath = resolve(skillDir, "tangent-acp-attach.zip");
writeFileSync(outPath, zipped);

console.log(`packed ${Object.keys(files).length} files -> ${outPath}`);
