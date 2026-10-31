import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { strToU8, zipSync } from "fflate";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { installBundle, loadInstalledConfig } from "./bundleLoader.ts";
import type { NpmInstaller } from "./npmPackages.ts";

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

/** Zips the example bundle with `patch` merged into its manifest, plus `extra` files. */
function packPatchedBundle(
  patch: Record<string, unknown>,
  extra: Record<string, string>,
): Buffer {
  const files = collectFiles(EXAMPLE_BUNDLE, EXAMPLE_BUNDLE, {});
  const manifest = parseYaml(new TextDecoder().decode(files["tangent.yaml"]));
  files["tangent.yaml"] = strToU8(stringifyYaml({ ...manifest, ...patch }));
  for (const [name, text] of Object.entries(extra)) files[name] = strToU8(text);
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

test("installBundle installs software.npm where trigger handlers resolve it", async () => {
  await withTempRoot(async (root) => {
    const calls: { specs: string[]; installRoot: string }[] = [];
    const fakeNpm: NpmInstaller = async (specs, installRoot) => {
      calls.push({ specs, installRoot });
      const pkg = path.join(installRoot, "node_modules", "demo-pkg");
      await mkdir(pkg, { recursive: true });
      await writeFile(
        path.join(pkg, "index.js"),
        'exports.greeting = "hello from demo-pkg";',
      );
    };
    const bundle = packPatchedBundle(
      {
        software: { npm: ["demo-pkg", "@tobilu/qmd:2.8.3"] },
        triggers: [
          {
            name: "digest",
            kind: "schedule",
            schedule: { every: "1h" },
            handler: "triggers/digest.ts",
          },
        ],
      },
      {
        "triggers/digest.ts":
          'import { greeting } from "demo-pkg";\nexport default () => greeting;\n',
      },
    );

    const { config } = await installBundle(bundle, root, fakeNpm);

    const installRoot = path.join(root, ".tangent");
    assert.deepEqual(calls, [
      { specs: ["demo-pkg", "@tobilu/qmd@2.8.3"], installRoot },
    ]);
    assert.deepEqual(config.binPaths, [
      path.join(installRoot, "node_modules", ".bin"),
    ]);
    assert.match(
      readFileSync(path.join(installRoot, "triggers", "digest.js"), "utf8"),
      /hello from demo-pkg/,
      "the handler bundles the installed package",
    );
    assert.deepStrictEqual(loadInstalledConfig(root), config);
  });
});

test("installBundle fails when its npm install fails", async () => {
  await withTempRoot(async (root) => {
    const bundle = packPatchedBundle({ software: { npm: ["demo-pkg"] } }, {});
    const failingNpm: NpmInstaller = async () => {
      throw new Error("bundle: npm install failed for demo-pkg");
    };

    await assert.rejects(
      installBundle(bundle, root, failingNpm),
      /npm install failed for demo-pkg/,
    );
  });
});

test("a bundle without software.npm adds nothing to PATH", async () => {
  await withTempRoot(async (root) => {
    const { config } = await installBundle(packExampleBundle(), root);
    assert.deepEqual(config.binPaths, []);
  });
});
