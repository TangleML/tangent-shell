import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Upper bound on a single npm install (ms). */
const NPM_INSTALL_TIMEOUT_MS = 120_000;

/** Max bytes captured from npm's stdout/stderr before it is killed. */
const NPM_MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Installs an npm `spec` (a registry name, a git url, or a local tarball path)
 * into `pkgDir` using the runtime `npm` on PATH, and returns the installed
 * package name.
 *
 * This shells out to `npm`, not pnpm: the target is the persistent volume
 * (`EXTENSIONS_ROOT`), not the repo workspace, so the repo's package manager is
 * irrelevant here. A holder `package.json` is written first so npm records the
 * one installed dependency, letting us read its name back (the key under
 * `dependencies`) rather than guessing it from the spec — which a git url or a
 * tarball doesn't carry. `--omit=peer` because Pi supplies the
 * `@earendil-works/*` peers, matching how the Dockerfile installs pi-memory.
 */
export async function npmInstall(
  pkgDir: string,
  spec: string,
): Promise<string> {
  await mkdir(pkgDir, { recursive: true });
  await writeFile(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: "tangent-extension-host",
      version: "0.0.0",
      private: true,
    }),
  );

  await execFileAsync(
    "npm",
    [
      "install",
      "--prefix",
      pkgDir,
      "--omit=peer",
      "--omit=dev",
      "--no-fund",
      "--no-audit",
      "--package-lock=false",
      spec,
    ],
    { timeout: NPM_INSTALL_TIMEOUT_MS, maxBuffer: NPM_MAX_BUFFER },
  );

  const manifest = JSON.parse(
    await readFile(path.join(pkgDir, "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  const name = Object.keys(manifest.dependencies ?? {})[0];
  if (!name) {
    throw new Error(`npm install produced no package for "${spec}"`);
  }
  return name;
}

/**
 * Installs the dependencies already declared in `dir`'s `package.json` (used
 * after extracting an archive package that ships a dependency tree). No-op for
 * a package with no dependencies.
 */
export async function npmInstallDeps(dir: string): Promise<void> {
  await execFileAsync(
    "npm",
    [
      "install",
      "--prefix",
      dir,
      "--omit=peer",
      "--omit=dev",
      "--no-fund",
      "--no-audit",
      "--package-lock=false",
    ],
    { timeout: NPM_INSTALL_TIMEOUT_MS, maxBuffer: NPM_MAX_BUFFER },
  );
}

/**
 * The absolute package root for a package installed under `pkgDir` by name.
 * A scoped name (`@scope/foo`) nests two segments under `node_modules`.
 */
export function installedPackageRoot(pkgDir: string, name: string): string {
  return path.join(pkgDir, "node_modules", ...name.split("/"));
}
