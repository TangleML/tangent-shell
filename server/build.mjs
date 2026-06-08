// Bundles the server into a single self-contained ESM file (`dist/index.js`)
// so it can run with plain `node` (no tsx, no node_modules) in production.
//
// Runtime assets that the server reads relative to `import.meta.dirname`
// (prompt files, agent templates, and the orchestrator extension that Pi loads
// as raw TypeScript) are copied next to the bundle, since bundling flattens
// everything into `dist/`.
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const piSrc = path.join(root, "server", "src", "pi");
const outDir = path.join(root, "dist");

await rm(outDir, { recursive: true, force: true });

await build({
  entryPoints: [path.join(root, "server", "src", "index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: path.join(outDir, "index.js"),
  // Resolve the server's `@shared/*` path alias.
  alias: { "@shared": path.join(root, "shared") },
  // esbuild now runs at runtime (to transpile bundle UI sources); it ships a
  // native binary and cannot be inlined, so keep it as a runtime dependency.
  external: ["esbuild"],
  // Provide `require` in the ESM output for CJS deps that reach for it.
  banner: {
    js: 'import { createRequire as _cr } from "node:module"; const require = _cr(import.meta.url);',
  },
});

// Assets are resolved against the bundle's directory (dist/) at runtime.
await cp(path.join(piSrc, "systemPrompt.md"), path.join(outDir, "systemPrompt.md"));
await cp(path.join(piSrc, "primePrompt.md"), path.join(outDir, "primePrompt.md"));
await cp(path.join(piSrc, "agents"), path.join(outDir, "agents"), {
  recursive: true,
});
await mkdir(path.join(outDir, "extensions"), { recursive: true });
await cp(
  path.join(piSrc, "extensions", "orchestrator.ts"),
  path.join(outDir, "extensions", "orchestrator.ts"),
);
await cp(
  path.join(piSrc, "extensions", "proxyProvider.ts"),
  path.join(outDir, "extensions", "proxyProvider.ts"),
);

console.log("[build:server] bundled server to dist/index.js");
