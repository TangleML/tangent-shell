#!/usr/bin/env tsx
/**
 * `ui-extensions` — local authoring CLI for Tangle UI extensions.
 *
 *   ui-extensions build [dir]       compile every ui.components entry to ui-dist/
 *   ui-extensions typecheck [dir]   type-check the bundle's ui/ sources
 *   ui-extensions init [dir]        scaffold a tsconfig.json for authoring
 *
 * `dir` defaults to the current working directory and must contain a
 * `tangent.yaml` manifest. `build` shares its esbuild config with the server, so
 * a component that builds here builds identically on upload.
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

import { parse } from "yaml";

import { buildUiComponent } from "./build";

interface UiComponent {
  name: string;
  entry: string;
}

interface Manifest {
  ui?: { components?: UiComponent[] };
}

const OUT_DIR = "ui-dist";

function fail(message: string): never {
  console.error(`ui-extensions: ${message}`);
  process.exit(1);
}

async function readComponents(dir: string): Promise<UiComponent[]> {
  const manifestPath = path.join(dir, "tangent.yaml");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    return fail(`no tangent.yaml found in ${dir}`);
  }
  const manifest = parse(raw) as Manifest | null;
  const components = manifest?.ui?.components ?? [];
  if (components.length === 0) {
    return fail(`no ui.components declared in ${manifestPath}`);
  }
  return components;
}

async function runBuild(dir: string): Promise<void> {
  const components = await readComponents(dir);
  const outDir = path.join(dir, OUT_DIR);
  await mkdir(outDir, { recursive: true });

  for (const component of components) {
    const entryPath = path.join(dir, component.entry);
    const output = await buildUiComponent(entryPath);
    const outPath = path.join(outDir, `${component.name}.js`);
    await writeFile(outPath, output);
    console.log(`ui-extensions: built ${component.name} -> ${outPath}`);
  }
}

function runTypecheck(dir: string): Promise<void> {
  const require = createRequire(import.meta.url);
  const tsc = require.resolve("typescript/bin/tsc");
  const tsconfig = path.join(dir, "tsconfig.json");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsc, "--noEmit", "-p", tsconfig], {
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code && code !== 0) process.exit(code);
      resolve();
    });
  });
}

const TSCONFIG_TEMPLATE = `${JSON.stringify(
  {
    extends: "@tangent/ui-extensions-sdk/tsconfig.author.json",
    include: ["ui/**/*.tsx"],
  },
  null,
  2,
)}\n`;

async function runInit(dir: string): Promise<void> {
  const tsconfigPath = path.join(dir, "tsconfig.json");
  await writeFile(tsconfigPath, TSCONFIG_TEMPLATE);
  console.log(`ui-extensions: wrote ${tsconfigPath}`);
}

async function main(): Promise<void> {
  const [command, dirArg] = process.argv.slice(2);
  const dir = path.resolve(dirArg ?? ".");

  if (command === "build") return runBuild(dir);
  if (command === "typecheck") return runTypecheck(dir);
  if (command === "init") return runInit(dir);

  return fail(
    `unknown command "${command ?? ""}". Use build, typecheck, or init.`,
  );
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
