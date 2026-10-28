import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mock, test } from "node:test";

import { installNpmPackages, npmBinDir, toNpmSpec } from "./npmPackages.ts";

/** Creates a throwaway install root and removes it after `fn`. */
async function withTempRoot(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-npm-"));
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Writes a fake `npm` that logs its argv to `<root>/npm.log`, then
 * either fails like a 404 or "installs" a `demo` binary under `--prefix`.
 */
function writeFakeNpm(root: string, outcome: "ok" | "fail"): string {
  const bin = path.join(root, "fake-npm");
  const install =
    outcome === "ok"
      ? 'mkdir -p "$3/node_modules/.bin" && touch "$3/node_modules/.bin/demo"'
      : 'echo "npm error 404 Not Found - demo" >&2; exit 1';
  writeFileSync(
    bin,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${root}/npm.log"\n${install}\n`,
    { mode: 0o755 },
  );
  return bin;
}

test("toNpmSpec maps registry entries to npm install specs", () => {
  assert.equal(toNpmSpec("better-sqlite3"), "better-sqlite3");
  assert.equal(toNpmSpec("@tobilu/qmd:2.8.3"), "@tobilu/qmd@2.8.3");
  assert.equal(toNpmSpec("pg:^8.11"), "pg@^8.11");
  assert.equal(toNpmSpec("pg:latest"), "pg@latest");
  assert.equal(toNpmSpec("pg:>=8 <9"), "pg@>=8 <9");
  assert.equal(toNpmSpec("JSONStream"), "JSONStream");
});

test("toNpmSpec rejects flags, local, git, URL, and alias specs", () => {
  for (const entry of [
    "--global",
    "-g",
    "../evil",
    "./tools",
    "evil.tgz",
    "user/repo",
    "x:file:/etc",
    "x:../evil",
    "github:user/repo",
    "https://example.com/x.tgz",
    "x:npm:y@1",
    "pg: 8",
  ]) {
    assert.equal(toNpmSpec(entry), undefined, `expected ${entry} rejected`);
  }
});

test("installNpmPackages installs into node_modules from a fresh prefix", async () => {
  await withTempRoot(async (root) => {
    mock.method(console, "log", () => {});
    const installRoot = path.join(root, ".tangent");
    const npm = writeFakeNpm(root, "ok");
    mkdirSync(installRoot);
    writeFileSync(path.join(installRoot, "package.json"), "{}");

    await installNpmPackages(["demo@1"], installRoot, npm);

    const args = readFileSync(path.join(root, "npm.log"), "utf8")
      .trimEnd()
      .split("\n");
    const stage = args[2];
    assert.deepEqual(args, [
      "install",
      "--prefix",
      stage,
      "--no-audit",
      "--no-fund",
      "demo@1",
    ]);
    assert.equal(path.dirname(stage), installRoot, "npm runs in a staging dir");
    assert.ok(existsSync(path.join(npmBinDir(installRoot), "demo")));
    assert.deepEqual(readdirSync(installRoot).sort(), [
      "node_modules",
      "package.json",
    ]);
  });
});

test("installNpmPackages surfaces npm's output and leaves nothing behind", async () => {
  await withTempRoot(async (root) => {
    mock.method(console, "log", () => {});
    const installRoot = mkdtempSync(path.join(root, "install-"));

    await assert.rejects(
      installNpmPackages(["demo"], installRoot, writeFakeNpm(root, "fail")),
      /npm install failed for demo\n[\s\S]*404 Not Found/,
    );
    assert.deepEqual(readdirSync(installRoot), []);
  });
});

test("installNpmPackages skips npm when there is nothing to install", async () => {
  await withTempRoot(async (root) => {
    await installNpmPackages([], root, writeFakeNpm(root, "fail"));
    assert.equal(existsSync(path.join(root, "npm.log")), false);
  });
});
