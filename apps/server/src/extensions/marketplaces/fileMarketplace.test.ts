import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { zipSync } from "fflate";

import { resolvePackageResources } from "../packageResources.ts";
import { FileMarketplace } from "./fileMarketplace.ts";

const ROOT = mkdtempSync(path.join(tmpdir(), "file-marketplace-"));
after(() => rmSync(ROOT, { recursive: true, force: true }));

const encoder = new TextEncoder();

/** Writes a zip of `files` to a temp path and returns it. */
function writeZip(name: string, files: Record<string, string>): string {
  const entries: Record<string, Uint8Array> = {};
  for (const [rel, content] of Object.entries(files)) {
    entries[rel] = encoder.encode(content);
  }
  const zipPath = path.join(ROOT, name);
  writeFileSync(zipPath, zipSync(entries));
  return zipPath;
}

test("installs an extension from a .zip and resolves its resources", async () => {
  const zipPath = writeZip("ext.zip", {
    "package.json": JSON.stringify({
      name: "zipped-ext",
      version: "0.1.0",
      pi: { extensions: ["index.ts"] },
    }),
    "index.ts": "// extension",
  });
  const pkgDir = path.join(ROOT, "install-zip", "pkg");

  const root = await new FileMarketplace().install("ext.zip", pkgDir, {
    sourcePath: zipPath,
  });

  assert.equal(root, pkgDir);
  assert.ok(existsSync(path.join(pkgDir, "index.ts")));
  const resources = await resolvePackageResources(root);
  assert.deepEqual(resources.extensions, ["index.ts"]);
});

test("rejects a .zip whose entry escapes the install directory", async () => {
  const zipPath = writeZip("evil.zip", {
    "../escape.ts": "// traversal",
  });
  const pkgDir = path.join(ROOT, "install-evil", "pkg");

  await assert.rejects(
    new FileMarketplace().install("evil.zip", pkgDir, { sourcePath: zipPath }),
    /unsafe entry path/,
  );
  assert.ok(!existsSync(path.join(ROOT, "install-evil", "escape.ts")));
});

test("copies a single-file extension source", async () => {
  const src = path.join(ROOT, "solo.ts");
  writeFileSync(src, "// solo extension");
  const pkgDir = path.join(ROOT, "install-solo", "pkg");

  const root = await new FileMarketplace().install("solo.ts", pkgDir, {
    sourcePath: src,
  });

  assert.equal(root, pkgDir);
  assert.ok(existsSync(path.join(pkgDir, "solo.ts")));
});

test("throws without a source path", async () => {
  await assert.rejects(
    new FileMarketplace().install("x.zip", path.join(ROOT, "nope"), {}),
    /requires an uploaded file/,
  );
});
