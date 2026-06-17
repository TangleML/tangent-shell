// Bundles the server into a single self-contained ESM file (`dist/index.js`)
// so it can run with plain `node` (no tsx, no node_modules) in production.
//
// Runtime assets that the server reads relative to `import.meta.dirname`
// (prompt files, agent templates, and the orchestrator extension that Pi loads
// as raw TypeScript) are copied next to the bundle, since bundling flattens
// everything into `dist/`.
import { existsSync, readdirSync, statSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const piSrc = path.join(serverDir, "src", "pi");
const migrationsSrc = path.join(serverDir, "src", "store", "db", "migrations");
const outDir = path.join(serverDir, "dist");

await rm(outDir, { recursive: true, force: true });

await build({
  entryPoints: [path.join(serverDir, "src", "index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: path.join(outDir, "index.js"),
  // `@tangent/shared` is a workspace package resolved from node_modules and
  // inlined into the bundle, so no path alias is needed.
  // esbuild now runs at runtime (to transpile bundle UI sources); it ships a
  // native binary and cannot be inlined, so keep it as a runtime dependency.
  // better-sqlite3 is a native addon and likewise stays external (resolved from
  // node_modules at runtime).
  external: ["esbuild", "better-sqlite3"],
  // Provide `require` in the ESM output for CJS deps that reach for it.
  banner: {
    js: 'import { createRequire as _cr } from "node:module"; const require = _cr(import.meta.url);',
  },
});

// Assets are resolved against the bundle's directory (dist/) at runtime.
await cp(
  path.join(piSrc, "subagentSystemPrompt.md"),
  path.join(outDir, "subagentSystemPrompt.md"),
);
await cp(
  path.join(piSrc, "primeSystemPrompt.md"),
  path.join(outDir, "primeSystemPrompt.md"),
);
await cp(path.join(piSrc, "agents"), path.join(outDir, "agents"), {
  recursive: true,
});
// Copy the whole extensions/ dir so every extension Pi loads at runtime is
// present, including ones added later. The files are self-contained (they only
// import Pi-resolved modules), so a flat recursive copy is complete.
await cp(path.join(piSrc, "extensions"), path.join(outDir, "extensions"), {
  recursive: true,
});

// drizzle-kit migrations applied at startup. The bundled db client resolves
// these via `new URL("./migrations", import.meta.url)`, i.e. `dist/migrations`.
await cp(migrationsSrc, path.join(outDir, "migrations"), { recursive: true });

// Fail the build loudly if any asset the server reads relative to dist/ is
// missing, so drift surfaces here instead of as a runtime "path does not
// exist" crash inside a Pi subprocess.
const requiredAssets = [
  "index.js",
  "subagentSystemPrompt.md",
  "primeSystemPrompt.md",
  "agents",
  path.join("extensions", "orchestrator.ts"),
  path.join("extensions", "proxyProvider.ts"),
  path.join("extensions", "memory.ts"),
  path.join("extensions", "triggers.ts"),
  path.join("extensions", "session.ts"),
  path.join("migrations", "meta", "_journal.json"),
];

const missing = [];
for (const asset of requiredAssets) {
  const target = path.join(outDir, asset);
  if (!existsSync(target)) {
    missing.push(asset);
    continue;
  }
  // Directory assets (e.g. agents/) must contain at least one file.
  if (statSync(target).isDirectory() && readdirSync(target).length === 0) {
    missing.push(`${asset} (empty)`);
  }
}

if (missing.length > 0) {
  console.error(
    `[build:server] missing required dist assets:\n  - ${missing.join("\n  - ")}`,
  );
  process.exit(1);
}

console.log("[build:server] bundled server to dist/index.js");
