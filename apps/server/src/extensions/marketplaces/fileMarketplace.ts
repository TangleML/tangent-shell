import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { unzipSync } from "fflate";

import type { ExtensionMarketplace, InstallContext } from "../types.ts";
import {
  installedPackageRoot,
  npmInstall,
  npmInstallDeps,
} from "./npmInstall.ts";

/** Archive extensions npm can install directly as a tarball. */
const TARBALL_EXTS = new Set([".tgz", ".tar", ".gz"]);

/** Single-file extension source extensions. */
const SINGLE_FILE_EXTS = new Set([".ts", ".js", ".mjs", ".cjs"]);

/**
 * A zip entry path is safe when it is a non-empty relative POSIX path with no
 * `..` traversal and no absolute/drive prefix. Mirrors the bundle loader's
 * guard so a malicious archive can't escape the install directory.
 */
function isSafeEntryPath(value: string): boolean {
  if (value.length === 0) return false;
  if (value.startsWith("/") || /^[a-zA-Z]:/.test(value)) return false;
  return value
    .split("/")
    .every((segment) => segment !== ".." && segment !== "");
}

/** Extracts a zip into `pkgDir`, rejecting traversal and directory entries. */
async function extractZip(zipPath: string, pkgDir: string): Promise<void> {
  const buffer = await readFile(zipPath);
  const entries = unzipSync(new Uint8Array(buffer));
  await mkdir(pkgDir, { recursive: true });
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith("/")) continue;
    if (!isSafeEntryPath(name)) {
      throw new Error(`extension archive: unsafe entry path "${name}"`);
    }
    const abs = path.join(pkgDir, ...name.split("/"));
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, data);
  }
}

/**
 * Resolves the package root inside an extracted zip: `pkgDir` itself when it
 * holds the `package.json` (or any resource), else a single top-level
 * subdirectory that does. Falls back to `pkgDir`.
 */
async function resolveExtractedRoot(pkgDir: string): Promise<string> {
  if (existsSync(path.join(pkgDir, "package.json"))) return pkgDir;
  const entries = await readdir(pkgDir, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory());
  const files = entries.filter((entry) => entry.isFile());
  if (dirs.length === 1 && files.length === 0) {
    return path.join(pkgDir, dirs[0].name);
  }
  return pkgDir;
}

/** Installs the extracted package's own dependencies, when it declares any. */
async function installExtractedDeps(root: string): Promise<void> {
  const manifestPath = path.join(root, "package.json");
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
    await npmInstallDeps(root);
  }
}

/**
 * The file marketplace: installs an uploaded extension from the preserved
 * `source/` file. A `.tgz`/tarball is handed to npm; a `.zip` is extracted
 * (with a traversal guard) and its dependencies installed; a lone `.ts`/`.js`
 * file is copied as a single extension. `ref` is the original filename, used
 * only for display/reinstall.
 */
export class FileMarketplace implements ExtensionMarketplace {
  readonly id = "file";

  async install(
    _ref: string,
    pkgDir: string,
    ctx: InstallContext,
  ): Promise<string> {
    const src = ctx.sourcePath;
    if (!src) {
      throw new Error("file marketplace requires an uploaded file");
    }
    const ext = path.extname(src).toLowerCase();

    if (TARBALL_EXTS.has(ext)) {
      const name = await npmInstall(pkgDir, src);
      return installedPackageRoot(pkgDir, name);
    }

    if (ext === ".zip") {
      await extractZip(src, pkgDir);
      const root = await resolveExtractedRoot(pkgDir);
      await installExtractedDeps(root);
      return root;
    }

    if (SINGLE_FILE_EXTS.has(ext)) {
      await mkdir(pkgDir, { recursive: true });
      await copyFile(src, path.join(pkgDir, path.basename(src)));
      return pkgDir;
    }

    throw new Error(`unsupported extension file type "${ext}"`);
  }
}
