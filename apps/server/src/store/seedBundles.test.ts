import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { zipSync } from "fflate";

import { FileAgentBundleStore } from "./fileAgentBundleStore.ts";
import { seedExampleBundles } from "./seedBundles.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
// apps/server/src/store -> repo root is four levels up.
const repoRoot = path.resolve(here, "../../../..");
const EXAMPLES_SRC = path.join(repoRoot, "examples");

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

/** Packs every `examples/<name>/` source folder into `<dir>/<name>.zip`. */
function packExamplesInto(dir: string): void {
  for (const entry of readdirSync(EXAMPLES_SRC, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = path.join(EXAMPLES_SRC, entry.name);
    const files = collectFiles(src, src, {});
    if (!("tangent.yaml" in files)) continue;
    writeFileSync(
      path.join(dir, `${entry.name}.zip`),
      Buffer.from(zipSync(files)),
    );
  }
}

/** Runs `body` with `SEED_BUNDLES_DIR` set, restoring it afterwards. */
async function withSeedDir(dir: string, body: () => Promise<void>) {
  const prev = process.env.SEED_BUNDLES_DIR;
  process.env.SEED_BUNDLES_DIR = dir;
  try {
    await body();
  } finally {
    if (prev === undefined) delete process.env.SEED_BUNDLES_DIR;
    else process.env.SEED_BUNDLES_DIR = prev;
  }
}

/** Packs the real example sources into a throwaway zip dir for `body`. */
async function withPackedExamples(body: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(path.join(tmpdir(), "seed-src-"));
  packExamplesInto(dir);
  try {
    await withSeedDir(dir, () => body(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A FileAgentBundleStore backed by a throwaway temp directory. */
function tempStore(): { store: FileAgentBundleStore; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "seed-bundles-"));
  return {
    store: new FileAgentBundleStore(root),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("seeds the example bundles into an empty marketplace", async () => {
  const { store, cleanup } = tempStore();
  try {
    await withPackedExamples(async () => {
      const installed = await seedExampleBundles(store);
      const bundles = await store.list();

      assert.equal(installed, bundles.length);
      assert.ok(installed >= 1, "expected at least one example bundle");

      const ids = bundles.map((b) => b.id);
      assert.ok(ids.includes("tangle-oss"), "expected the `tangle-oss` bundle");
      assert.equal(new Set(ids).size, ids.length, "bundle ids must be unique");
    });
  } finally {
    cleanup();
  }
});

test("is a no-op against an already-populated marketplace", async () => {
  const { store, cleanup } = tempStore();
  try {
    await withPackedExamples(async () => {
      const first = await seedExampleBundles(store);
      assert.ok(first >= 1);

      const again = await seedExampleBundles(store);
      assert.equal(again, 0, "re-seeding should install nothing");
      assert.equal((await store.list()).length, first, "count unchanged");
    });
  } finally {
    cleanup();
  }
});

test("does nothing when the examples directory is absent", async () => {
  const { store, cleanup } = tempStore();
  try {
    await withSeedDir(path.join(tmpdir(), "seed-bundles-does-not-exist"), () =>
      (async () => {
        const installed = await seedExampleBundles(store);
        assert.equal(installed, 0);
        assert.equal((await store.list()).length, 0);
      })(),
    );
  } finally {
    cleanup();
  }
});
