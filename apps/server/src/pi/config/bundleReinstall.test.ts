import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { zipSync } from "fflate";

import { INSTALL_RECORD_FILENAME, installBundle } from "./bundleLoader.ts";
import { BundleRootConflictError, stageBundle } from "./bundleReinstall.ts";

const encoder = new TextEncoder();

function zip(files: Record<string, string>): Buffer {
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([rel, text]) => [rel, encoder.encode(text)]),
      ),
    ),
  );
}

function manifest(version: string, extra = ""): string {
  return [
    "schemaVersion: 1",
    "id: demo",
    "name: Demo",
    `version: ${version}`,
    "prime:",
    "  systemPrompt: prompts/prime.md",
    extra,
  ].join("\n");
}

const V1 = zip({
  "tangent.yaml": manifest("1.0.0", "contextFiles:\n  - context/brief.md"),
  "prompts/prime.md": "prime v1",
  "rules/AGENTS.md": "rules v1",
  "memory/notes.md": "seed v1",
  "context/brief.md": "brief v1",
  "skills/old/SKILL.md": "old skill",
  "agents/scout.md": "---\nname: scout\n---\nscout v1",
});

const V2 = zip({
  "tangent.yaml": manifest("2.0.0"),
  "prompts/prime.md": "prime v2",
  "rules/AGENTS.md": "rules v2",
  "memory/notes.md": "seed v2",
  "memory/extra.md": "extra seed",
  "skills/new/SKILL.md": "new skill",
});

const read = (root: string, rel: string) =>
  readFileSync(path.join(root, rel), "utf8");

/** A v1 session that has run for a while: chats, triggers, edited memory, work. */
async function withRunningSession(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-reinstall-"));
  try {
    await installBundle(V1, root);
    mkdirSync(path.join(root, ".tangent/chats"), { recursive: true });
    writeFileSync(path.join(root, ".tangent/chats/prime.jsonl"), "{}\n");
    writeFileSync(path.join(root, ".tangent/triggers.json"), "{}\n");
    writeFileSync(path.join(root, "notes.md"), "edited by the agent");
    writeFileSync(path.join(root, "MEMORY.md"), "session memory");
    mkdirSync(path.join(root, "artifacts"));
    writeFileSync(path.join(root, "artifacts/chart.png"), "png");
    writeFileSync(path.join(root, "analysis.py"), "print(1)");
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("reinstall replaces bundle files and keeps session-owned state", async () => {
  await withRunningSession(async (root) => {
    const staged = await stageBundle(V2, root);
    const config = await staged.commit();

    assert.equal(staged.manifest.version, "2.0.0");
    assert.equal(read(root, ".tangent/prompts/prime.md"), "prime v2");
    assert.equal(read(root, "AGENTS.md"), "rules v2");
    assert.match(config.prime.appendSystemPrompt, /prime v2/);
    assert.deepEqual(config.skillPaths, [
      path.join(root, ".tangent/skills/new"),
    ]);
    assert.equal(config.templates.size, 0, "dropped agents/ is gone");
    assert.equal(existsSync(path.join(root, ".tangent/skills/old")), false);
    assert.equal(existsSync(path.join(root, "brief.md")), false);

    assert.equal(read(root, ".tangent/chats/prime.jsonl"), "{}\n");
    assert.equal(read(root, ".tangent/triggers.json"), "{}\n");
    assert.equal(read(root, "notes.md"), "edited by the agent");
    assert.equal(read(root, "extra.md"), "extra seed", "new seeds are added");
    assert.equal(read(root, "MEMORY.md"), "session memory");
    assert.equal(read(root, "artifacts/chart.png"), "png");
    assert.equal(read(root, "analysis.py"), "print(1)");
    assert.deepEqual(
      readdirSync(root).filter((name) => name.startsWith(".tangent-")),
      [],
      "staging is cleaned up",
    );
  });
});

test("reinstall of a session installed before the install record", async () => {
  await withRunningSession(async (root) => {
    rmSync(path.join(root, ".tangent", INSTALL_RECORD_FILENAME));
    const staged = await stageBundle(V2, root);
    await staged.commit();

    assert.equal(read(root, ".tangent/prompts/prime.md"), "prime v2");
    assert.equal(existsSync(path.join(root, ".tangent/agents")), false);
    assert.equal(existsSync(path.join(root, "brief.md")), false);
    assert.equal(read(root, ".tangent/chats/prime.jsonl"), "{}\n");
    assert.equal(read(root, "notes.md"), "edited by the agent");
  });
});

test("an invalid bundle fails staging and leaves the session untouched", async () => {
  await withRunningSession(async (root) => {
    const broken = zip({ "tangent.yaml": manifest("3.0.0") });
    await assert.rejects(stageBundle(broken, root), /prompts\/prime\.md/);
    assert.equal(read(root, ".tangent/prompts/prime.md"), "prime v1");
    assert.equal(read(root, "AGENTS.md"), "rules v1");
    assert.deepEqual(
      readdirSync(root).filter((name) => name.startsWith(".tangent-")),
      [],
    );
  });
});

test("a discarded stage changes nothing", async () => {
  await withRunningSession(async (root) => {
    const staged = await stageBundle(V2, root);
    await staged.discard();
    assert.equal(read(root, ".tangent/prompts/prime.md"), "prime v1");
    assert.equal(read(root, "brief.md"), "brief v1");
  });
});

/** A v2 that also ships the given context files to the session root. */
function v2WithContext(files: Record<string, string>): Buffer {
  const list = Object.keys(files).map((rel) => `  - ${rel}`);
  return zip({
    "tangent.yaml": manifest("2.0.0", ["contextFiles:", ...list].join("\n")),
    "prompts/prime.md": "prime v2",
    ...files,
  });
}

/** Everything a session owns, so a refused reinstall can be shown to leave it as is. */
function sessionData(root: string): Record<string, string> {
  return {
    memory: read(root, "MEMORY.md"),
    artifact: read(root, "artifacts/chart.png"),
    work: read(root, "analysis.py"),
    notes: read(root, "notes.md"),
    chats: read(root, ".tangent/chats/prime.jsonl"),
    prompt: read(root, ".tangent/prompts/prime.md"),
  };
}

test("context files that collide with session data are refused before anything moves", async () => {
  for (const name of ["MEMORY.md", "artifacts", "analysis.py", "shared"]) {
    await withRunningSession(async (root) => {
      mkdirSync(path.join(root, "..", `${path.basename(root)}-mount`));
      symlinkSync(
        path.join(root, "..", `${path.basename(root)}-mount`),
        path.join(root, "shared"),
      );
      const before = sessionData(root);

      await assert.rejects(
        stageBundle(v2WithContext({ [`context/${name}`]: "bundle" }), root),
        BundleRootConflictError,
        `context file "${name}" is refused`,
      );

      assert.deepEqual(sessionData(root), before, `"${name}" left data intact`);
      assert.ok(existsSync(path.join(root, "shared")), "the mount survives");
      assert.deepEqual(
        readdirSync(root).filter((entry) => entry.startsWith(".tangent-")),
        [],
      );
      rmSync(path.join(root, "..", `${path.basename(root)}-mount`), {
        recursive: true,
        force: true,
      });
    });
  }
});

test("an install record never makes session memory bundle-owned", async () => {
  await withRunningSession(async (root) => {
    const recordFile = path.join(root, ".tangent", INSTALL_RECORD_FILENAME);
    const record = JSON.parse(readFileSync(recordFile, "utf8"));
    record.rootFiles.push("MEMORY.md", "artifacts");
    writeFileSync(recordFile, JSON.stringify(record));

    await (await stageBundle(V2, root)).commit();

    assert.equal(read(root, "MEMORY.md"), "session memory");
    assert.equal(read(root, "artifacts/chart.png"), "png");
  });
});
