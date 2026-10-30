// Bundles the headless local agent into the single executable the
// `tangent-local-agent` skill ships. Workspace packages and socket.io-client
// are inlined, so the skill folder needs no node_modules.
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(cliDir, "..", "..");
const skillDir = path.join(
  repoRoot,
  ".cursor",
  "skills",
  "tangent-local-agent",
);
const scriptsDir = path.join(skillDir, "scripts");
const outfile = path.join(scriptsDir, "tangent-local-agent.cjs");

// The only variables the client reads for Oktasso SSO. Vendored next to the
// bundle so the shipped skill self-mints out of the box; unrelated secrets are
// deliberately dropped. Real environment variables still override the file.
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

/**
 * Writes the repo-root `.env`'s Oktasso lines into the skill dir as `.env` and
 * `sso.config` (loadEnv reads either). Best-effort: a missing `.env` or absent
 * keys only warn, so `pnpm build` without an `.env` (CI) still succeeds — the
 * runtime environment or a cwd `.env` can supply the config instead.
 */
async function vendorOktassoConfig() {
  let raw;
  try {
    raw = await readFile(path.join(repoRoot, ".env"), "utf8");
  } catch {
    console.warn(
      "[build:local-agent-cli] no repo .env; skipping Oktasso config vendoring.",
    );
    return;
  }
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
    console.warn(
      `[build:local-agent-cli] repo .env missing Oktasso keys (${missing.join(", ")}); skipping vendoring.`,
    );
    return;
  }
  const env = `${kept.join("\n")}\n`;
  await writeFile(path.join(skillDir, ".env"), env);
  await writeFile(path.join(skillDir, "sso.config"), env);
  console.log("[build:local-agent-cli] vendored Oktasso config into skill dir");
}

await mkdir(scriptsDir, { recursive: true });
await copyFile(
  fileURLToPath(
    import.meta.resolve("@tangent/local-agent-host/resources/proxyProvider.ts"),
  ),
  path.join(scriptsDir, "proxyProvider.ts"),
);
await copyFile(
  fileURLToPath(
    import.meta
      .resolve("@tangent/local-agent-host/resources/sessionResources.ts"),
  ),
  path.join(scriptsDir, "sessionResources.ts"),
);
await build({
  entryPoints: [path.join(cliDir, "src", "main.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile,
  banner: {
    js: [
      "#!/usr/bin/env node",
      'const __bundleUrl = require("node:url").pathToFileURL(__filename).href;',
    ].join("\n"),
  },
  define: { "import.meta.url": "__bundleUrl" },
  // The ws native add-ons are optional and loaded behind a try/catch.
  external: ["bufferutil", "utf-8-validate"],
  legalComments: "none",
});
await chmod(outfile, 0o755);
await vendorOktassoConfig();
console.log(
  "[build:local-agent-cli] bundled to .cursor/skills/tangent-local-agent/scripts/",
);
