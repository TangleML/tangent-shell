// Bundles the headless local agent into the single executable the
// `tangent-local-agent` skill ships. Workspace packages and socket.io-client
// are inlined, so the skill folder needs no node_modules.
import { chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(cliDir, "..", "..");
const scriptsDir = path.join(
  repoRoot,
  ".cursor",
  "skills",
  "tangent-local-agent",
  "scripts",
);
const outfile = path.join(scriptsDir, "tangent-local-agent.cjs");

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
console.log(
  "[build:local-agent-cli] bundled to .cursor/skills/tangent-local-agent/scripts/",
);
