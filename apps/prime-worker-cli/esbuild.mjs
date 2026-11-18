import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(here, "dist/skill");

// One self-contained script, so the installed skill folder needs no node_modules.
const result = await build({
  entryPoints: [resolve(here, "src/main.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  target: "node20",
  // socket.io's CommonJS dependencies call `require`, which ESM lacks.
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire } from "node:module";',
      "const require = createRequire(import.meta.url);",
    ].join("\n"),
  },
  // Optional ws natives socket.io never needs; left external so they don't break.
  external: ["bufferutil", "utf-8-validate"],
  logLevel: "info",
});

const scriptsDir = resolve(skillDir, "scripts");
mkdirSync(scriptsDir, { recursive: true });
const outfile = resolve(scriptsDir, "tangent-prime-worker.mjs");
writeFileSync(outfile, result.outputFiles[0].contents);
chmodSync(outfile, 0o755);
copyFileSync(resolve(here, "SKILL.md"), resolve(skillDir, "SKILL.md"));
console.log(`generated skill in ${skillDir}`);
