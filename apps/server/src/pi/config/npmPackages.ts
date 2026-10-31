import { execFile } from "node:child_process";
import { mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { NPM_BIN } from "../../config.ts";

const execFileAsync = promisify(execFile);

// Mixed case is allowed for legacy registry packages such as `JSONStream`.
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[A-Za-z0-9][A-Za-z0-9._~-]*$/;
// npm installs a bare `*.tgz`/`*.tar` argument as a local file.
const TARBALL_NAME = /\.(?:tgz|tar|tar\.gz)$/i;
// Registry versions, ranges, and tags only: rejects `file:`, git, URL, and alias specs.
const NPM_VERSION = /^[0-9A-Za-z.^~<>=*|+-]+(?: [0-9A-Za-z.^~<>=*|+-]+)*$/;

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const ERROR_TAIL_CHARS = 4000;

/** Installs npm specs into `installRoot`; injectable so tests stay offline. */
export type NpmInstaller = (
  specs: string[],
  installRoot: string,
) => Promise<void>;

/**
 * Converts a `software.npm` entry (`<package>` or `<package>:<version>`) to an
 * npm install spec, or `undefined` when it is not a plain registry package.
 */
export function toNpmSpec(entry: string): string | undefined {
  const [name, version, ...rest] = entry.split(":");
  if (rest.length > 0 || !NPM_NAME.test(name) || TARBALL_NAME.test(name)) {
    return undefined;
  }
  if (version === undefined) return name;
  return NPM_VERSION.test(version) ? `${name}@${version}` : undefined;
}

/** The install specs for a manifest's (already validated) `software.npm`. */
export function npmSpecs(entries: string[] | undefined): string[] {
  return (entries ?? []).flatMap((entry) => toNpmSpec(entry) ?? []);
}

/** Where the installed packages' executables land under an install root. */
export function npmBinDir(installRoot: string): string {
  return path.join(installRoot, "node_modules", ".bin");
}

/**
 * Installs `specs` into `<installRoot>/node_modules`, throwing with npm's
 * output tail. npm runs in a fresh prefix so a bundle-shipped `package.json`,
 * lockfile, or `.npmrc` can't add packages or change the registry.
 */
export async function installNpmPackages(
  specs: string[],
  installRoot: string,
  npmBin: string = NPM_BIN,
): Promise<void> {
  if (specs.length === 0) return;
  console.log(`[bundle] installing npm packages into ${installRoot}`, specs);
  const stage = await mkdtemp(path.join(installRoot, ".npm-"));
  try {
    await execFileAsync(
      npmBin,
      ["install", "--prefix", stage, "--no-audit", "--no-fund", ...specs],
      { cwd: stage, timeout: INSTALL_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
    );
    await rename(
      path.join(stage, "node_modules"),
      path.join(installRoot, "node_modules"),
    );
  } catch (err) {
    const detail = (err instanceof Error ? err.message : String(err)).slice(
      -ERROR_TAIL_CHARS,
    );
    throw new Error(
      `bundle: npm install failed for ${specs.join(", ")}\n${detail}`,
      { cause: err },
    );
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
