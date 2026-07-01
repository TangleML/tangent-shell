/**
 * Packs a Tangent Configuration Bundle source folder into a `*.zip`.
 *
 * Usage:
 *   node scripts/pack-bundle.mjs [sourceDir]
 *
 * `sourceDir` defaults to `examples/tangle-oss`. The folder's
 * `tangent.yaml` is read to derive the bundle `id`, and the archive is written
 * to `examples/<id>.zip`.
 *
 * The walk skips dotfiles and OS junk, uses forward-slash relative paths, and
 * rejects any entry that would escape the source root. A fixed mtime is used so
 * repacking unchanged sources yields byte-identical archives.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { zipSync } from "fflate";
import { parse as parseYaml } from "yaml";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_SOURCE = "examples/tangle-oss";
const OUTPUT_DIR = "examples";

/** Skip OS junk and any dotfile/dotdir. */
function shouldSkip(name) {
  return name === ".DS_Store" || name.startsWith(".");
}

/**
 * Recursively collect regular files under `dir` as a map of POSIX-relative path
 * (relative to `root`) to file contents. Rejects entries that escape `root`.
 */
function collectFiles(root, dir, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;

    const absolute = join(dir, entry.name);
    const rel = relative(root, absolute);
    if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
      throw new Error(`refusing to pack entry outside the source root: ${rel}`);
    }

    if (entry.isDirectory()) {
      collectFiles(root, absolute, files);
    } else if (entry.isFile()) {
      const posixPath = rel.split(sep).join("/");
      files[posixPath] = new Uint8Array(readFileSync(absolute));
    }
  }
  return files;
}

function main() {
  const sourceArg = process.argv[2] ?? DEFAULT_SOURCE;
  const sourceDir = resolve(repoRoot, sourceArg);

  if (!statSync(sourceDir).isDirectory()) {
    throw new Error(`source is not a directory: ${sourceDir}`);
  }

  const manifestPath = join(sourceDir, "tangent.yaml");
  const manifest = parseYaml(readFileSync(manifestPath, "utf8"));
  const id = manifest?.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`tangent.yaml is missing a string "id": ${manifestPath}`);
  }

  const files = collectFiles(sourceDir, sourceDir, {});
  const entries = Object.keys(files).sort();
  if (entries.length === 0) {
    throw new Error(`no files found to pack in ${sourceDir}`);
  }

  // Fixed mtime keeps repacks byte-identical. fflate derives the ZIP timestamp
  // from the Date's local components, so we use a mid-range date well clear of
  // the format's 1980-2099 bounds in any timezone. Pass entries sorted.
  const sorted = {};
  for (const key of entries) sorted[key] = files[key];
  const zipped = zipSync(sorted, { mtime: new Date(2020, 0, 1, 12) });

  const outPath = resolve(repoRoot, OUTPUT_DIR, `${id}.zip`);
  writeFileSync(outPath, zipped);

  console.log(`Packed ${entries.length} files from ${sourceArg}:`);
  for (const key of entries) console.log(`  ${key}`);
  console.log(`-> ${relative(repoRoot, outPath)} (${zipped.length} bytes)`);
}

main();
