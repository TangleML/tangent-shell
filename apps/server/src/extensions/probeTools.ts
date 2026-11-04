import { spawn } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PI_BIN } from "../config.ts";

const PNPM_PREFIX = "@earendil-works+pi-coding-agent@";
const PKG_SUBPATH = "node_modules/@earendil-works/pi-coding-agent";
const LOADER_SUBPATH = "dist/core/extensions/loader.js";
const PROBE_TIMEOUT_MS = 20_000;

/**
 * A standalone ESM probe: it loads exactly the given extension paths through
 * Pi's own loader (so `.ts`/`.js`/directory resolution matches a real spawn)
 * and prints the union of their registered tool names. Kept as source rather
 * than a shipped file so the server bundle needs no extra runtime asset.
 */
const PROBE_SOURCE = `
import { pathToFileURL } from "node:url";
const cfg = JSON.parse(Buffer.from(process.argv[2], "base64").toString("utf8"));
const loader = await import(pathToFileURL(cfg.loaderPath).href);
const res = await loader.loadExtensions(cfg.paths, cfg.cwd);
const tools = new Set();
for (const ext of res.extensions) for (const name of ext.tools.keys()) tools.add(name);
process.stdout.write(JSON.stringify({ tools: [...tools] }));
`;

/** Realpath of the `pi` executable, resolved from an absolute path or `PATH`. */
function resolvePiBinPath(bin: string): string | null {
  if (bin.includes(path.sep)) {
    return existsSync(bin) ? realpathSync(bin) : null;
  }
  const dirs = (process.env.PATH ?? "").split(path.delimiter);
  for (const dir of dirs) {
    const candidate = path.join(dir, bin);
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  return null;
}

/** Ascends from a directory looking for a package that ships the loader file. */
function ascendForLoader(startDir: string): string | null {
  let dir = startDir;
  for (let depth = 0; depth < 6; depth += 1) {
    const loader = path.join(dir, LOADER_SUBPATH);
    if (existsSync(loader)) return loader;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Finds the loader inside a pnpm virtual store directory, newest version first. */
function scanPnpmStore(pnpmDir: string): string | null {
  const dirs = readdirSync(pnpmDir)
    .filter((name) => name.startsWith(PNPM_PREFIX))
    .sort()
    .reverse();
  for (const name of dirs) {
    const loader = path.join(pnpmDir, name, PKG_SUBPATH, LOADER_SUBPATH);
    if (existsSync(loader)) return loader;
  }
  return null;
}

/** Ascends from a directory searching each `node_modules/.pnpm` store for Pi. */
function findInPnpmStore(startDir: string): string | null {
  let dir = startDir;
  for (let depth = 0; depth < 8; depth += 1) {
    const pnpmDir = path.join(dir, "node_modules", ".pnpm");
    if (existsSync(pnpmDir)) {
      const hit = scanPnpmStore(pnpmDir);
      if (hit) return hit;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Locates Pi's extension loader across deployment layouts: an explicit
 * `PI_EXTENSION_LOADER` override, the `pi` binary's own package (npm global or
 * local installs), or the workspace pnpm store (the monorepo dev setup, where
 * the on-`PATH` `pi` is a standalone binary with no reachable package files).
 */
function resolveLoaderPath(): string | null {
  const override = process.env.PI_EXTENSION_LOADER;
  if (override && existsSync(override)) return override;

  const binPath = resolvePiBinPath(PI_BIN);
  const fromBin = binPath ? ascendForLoader(path.dirname(binPath)) : null;
  if (fromBin) return fromBin;

  return findInPnpmStore(path.dirname(fileURLToPath(import.meta.url)));
}

/** Runs the probe subprocess, resolving its raw stdout or `null` on failure. */
function execProbe(scriptPath: string, cfg: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, cfg], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, PROBE_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
      if (stderr)
        console.error(`[extensions] tool probe failed: ${stderr.trim()}`);
      resolve(null);
    });
  });
}

/** Parses the probe's JSON stdout into a string tool list (or `null`). */
function parseProbeOutput(out: string): string[] | null {
  try {
    const data: unknown = JSON.parse(out);
    const tools = (data as { tools?: unknown }).tools;
    if (!Array.isArray(tools)) return null;
    return tools.filter((tool): tool is string => typeof tool === "string");
  } catch {
    return null;
  }
}

/** Materializes the probe script to a temp file and runs it against `paths`. */
async function runProbe(
  loaderPath: string,
  paths: string[],
  cwd: string,
): Promise<string[] | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "ext-probe-"));
  const scriptPath = path.join(dir, "probe.mjs");
  try {
    await writeFile(scriptPath, PROBE_SOURCE);
    const cfg = Buffer.from(
      JSON.stringify({ loaderPath, paths, cwd }),
    ).toString("base64");
    const out = await execProbe(scriptPath, cfg);
    return out === null ? null : parseProbeOutput(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Enumerates the tool names a set of extension files registers, by loading them
 * in an isolated Node subprocess through Pi's own extension loader. Returns the
 * deduped names, or `null` when the probe can't run (no `pi` on `PATH`, an
 * unexpected package layout, a load error, or a timeout) so callers can fall
 * back to a safe default.
 */
export async function probeExtensionTools(
  extensionPaths: string[],
  cwd: string,
): Promise<string[] | null> {
  if (extensionPaths.length === 0) return null;
  const loaderPath = resolveLoaderPath();
  if (!loaderPath) return null;
  return runProbe(loaderPath, extensionPaths, cwd);
}
