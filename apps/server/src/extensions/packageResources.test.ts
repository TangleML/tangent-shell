import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  declaredTools,
  readPackageManifest,
  resolvePackageResources,
} from "./packageResources.ts";

const ROOT = mkdtempSync(path.join(tmpdir(), "pkg-resources-"));
after(() => rmSync(ROOT, { recursive: true, force: true }));

/** Builds a throwaway package directory and returns its absolute path. */
function makePackage(name: string, files: Record<string, string>): string {
  const dir = path.join(ROOT, name);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

test("resolves a declared pi manifest (extensions + skills + prompts)", async () => {
  const dir = makePackage("manifest", {
    "package.json": JSON.stringify({
      name: "manifest-pkg",
      version: "2.0.0",
      pi: {
        extensions: ["index.ts"],
        skills: ["skills"],
        prompts: ["prompts/*.md"],
      },
      tangent: { tools: ["alpha", "beta"] },
    }),
    "index.ts": "// extension",
    "skills/one/SKILL.md": "# one",
    "skills/two/SKILL.md": "# two",
    "prompts/review.md": "review",
    "prompts/plan.md": "plan",
  });

  const resources = await resolvePackageResources(dir);
  assert.deepEqual(resources.extensions, ["index.ts"]);
  assert.deepEqual(resources.skills, ["skills/one", "skills/two"]);
  assert.deepEqual(resources.prompts, ["prompts/plan.md", "prompts/review.md"]);

  const manifest = await readPackageManifest(dir);
  assert.deepEqual(declaredTools(manifest), ["alpha", "beta"]);
});

test("keeps a declared directory as one extension (not every file inside)", async () => {
  // Mirrors pi-web-access: `pi.extensions: ["./dist"]`, where dist holds the
  // real entry (index.js) beside a `bin` CLI (mcp-cli.js) with no factory. Pi
  // resolves the directory's index, so we must emit the directory, not a file
  // list that would make Pi try to load the CLI and crash.
  const dir = makePackage("dir-extension", {
    "package.json": JSON.stringify({
      name: "dir-extension-pkg",
      pi: { extensions: ["./dist"] },
    }),
    "dist/index.js": "// entry",
    "dist/mcp-cli.js": "#!/usr/bin/env node",
  });

  const resources = await resolvePackageResources(dir);
  assert.deepEqual(resources.extensions, ["dist"]);
});

test("still expands a glob extension pattern to matching code files", async () => {
  const dir = makePackage("glob-extension", {
    "package.json": JSON.stringify({
      name: "glob-extension-pkg",
      pi: { extensions: ["ext/*.js"] },
    }),
    "ext/a.js": "// a",
    "ext/b.js": "// b",
    "ext/notes.md": "doc",
  });

  const resources = await resolvePackageResources(dir);
  assert.deepEqual(resources.extensions, ["ext/a.js", "ext/b.js"]);
});

test("falls back to conventional directories when no pi manifest", async () => {
  const dir = makePackage("conventional", {
    "package.json": JSON.stringify({ name: "conventional-pkg" }),
    "extensions/a.ts": "// a",
    "extensions/b.js": "// b",
    "skills/solo/SKILL.md": "# solo",
    "prompts/p.md": "p",
  });

  const resources = await resolvePackageResources(dir);
  assert.deepEqual(resources.extensions, [
    "extensions/a.ts",
    "extensions/b.js",
  ]);
  assert.deepEqual(resources.skills, ["skills/solo"]);
  assert.deepEqual(resources.prompts, ["prompts/p.md"]);
});

test("treats a root SKILL.md as one skill", async () => {
  const dir = makePackage("root-skill", { "SKILL.md": "# root" });
  const resources = await resolvePackageResources(dir);
  assert.deepEqual(resources.skills, ["."]);
  assert.deepEqual(resources.extensions, []);
});

test("treats a lone code file as one extension", async () => {
  const dir = makePackage("single-file", { "tool.ts": "// tool" });
  const resources = await resolvePackageResources(dir);
  assert.deepEqual(resources.extensions, ["tool.ts"]);
  assert.deepEqual(resources.skills, []);
});
