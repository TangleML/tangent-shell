import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { zipSync } from "fflate";

import { installBundle, loadInstalledConfig } from "./bundleLoader.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
// apps/server/src/pi/config -> repo root is five levels up.
const repoRoot = path.resolve(here, "../../../../..");
const EXAMPLE_BUNDLE = path.join(repoRoot, "examples/research-assistant");

/** Collects a bundle source dir into the POSIX-keyed entries fflate zips. */
function collectFiles(
  root: string,
  dir: string,
  files: Record<string, Uint8Array>,
): Record<string, Uint8Array> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(root, abs, files);
      continue;
    }
    const rel = path.relative(root, abs).split(path.sep).join("/");
    files[rel] = new Uint8Array(readFileSync(abs));
  }
  return files;
}

/** Zips the example bundle source folder into an in-memory ZIP buffer. */
function packExampleBundle(): Buffer {
  const files = collectFiles(EXAMPLE_BUNDLE, EXAMPLE_BUNDLE, {});
  return Buffer.from(zipSync(files));
}

/** Creates a throwaway session root and removes it after `fn`. */
function withTempRoot(
  fn: (root: string) => Promise<void> | void,
): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-bundle-"));
  return Promise.resolve(fn(root)).finally(() =>
    rmSync(root, { recursive: true, force: true }),
  );
}

test("loadInstalledConfig reproduces installBundle's resolved config", async () => {
  await withTempRoot(async (root) => {
    const { config: installed } = await installBundle(
      packExampleBundle(),
      root,
    );
    const reloaded = loadInstalledConfig(root);

    assert.ok(reloaded, "expected a config to be recovered from disk");
    assert.deepStrictEqual(reloaded, installed);
  });
});

test("loadInstalledConfig returns undefined for a plain session root", async () => {
  await withTempRoot((root) => {
    assert.equal(loadInstalledConfig(root), undefined);
  });
});

test("loadInstalledConfig skips non-file entries in the installed tree", async () => {
  await withTempRoot(async (root) => {
    const { config: installed } = await installBundle(
      packExampleBundle(),
      root,
    );
    const target = path.join(root, "linked-dir-target");
    mkdirSync(target);
    symlinkSync(target, path.join(root, ".tangent", "linked-dir"));

    const reloaded = loadInstalledConfig(root);

    assert.ok(reloaded, "expected a config to be recovered from disk");
    assert.deepStrictEqual(reloaded, installed);
  });
});
