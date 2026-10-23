import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const skillSource = resolve(here, "SKILL.md");

// The skill ships to every agent home; keep them byte-identical.
const skillDirs = [
  resolve(repoRoot, ".cursor/skills/tangent-acp-attach"),
  resolve(repoRoot, ".claude/skills/tangent-acp-attach"),
  resolve(repoRoot, ".codex/skills/tangent-acp-attach"),
  resolve(repoRoot, ".pi/skills/tangent-acp-attach"),
];

// Bundled as ESM: the ACP SDK is ESM-only, and the bundle keeps `import.meta`.
// The skill folder needs no node_modules — workspace deps and the SDK inline.
const result = await build({
  entryPoints: [resolve(here, "src/main.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  // Optional ws natives the SDK never needs; left external so they don't break.
  external: ["bufferutil", "utf-8-validate"],
  logLevel: "info",
});

const bundle = result.outputFiles[0].contents;

for (const skillDir of skillDirs) {
  const scriptsDir = resolve(skillDir, "scripts");
  mkdirSync(scriptsDir, { recursive: true });
  const outfile = resolve(scriptsDir, "tangent-acp-attach.mjs");
  writeFileSync(outfile, bundle);
  chmodSync(outfile, 0o755);
  copyFileSync(skillSource, resolve(skillDir, "SKILL.md"));
  console.log(`generated skill in ${skillDir}`);
}
