import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir before importing modules that read
// config at load time.
const ROOT = mkdtempSync(path.join(tmpdir(), "bundle-editor-store-"));
process.env.SESSIONS_ROOT = ROOT;

const { openDb } = await import("./db/client.ts");
const { SqliteBundleEditorStore } =
  await import("./sqliteBundleEditorStore.ts");

after(() => rmSync(ROOT, { recursive: true, force: true }));

function newStore() {
  return new SqliteBundleEditorStore(openDb(":memory:"));
}

test("add stores an editor and has/list see it", async () => {
  const store = newStore();
  const editor = await store.add("editor@example.com", "admin@example.com");

  assert.equal(editor.email, "editor@example.com");
  assert.equal(editor.addedBy, "admin@example.com");
  assert.equal(await store.has("editor@example.com"), true);
  assert.equal(await store.has("someone@example.com"), false);
  assert.deepEqual(
    (await store.list()).map((e) => e.email),
    ["editor@example.com"],
  );
});

test("adding an existing editor keeps the original row", async () => {
  const store = newStore();
  const first = await store.add("editor@example.com", "first@example.com");
  const again = await store.add("editor@example.com", "second@example.com");

  assert.deepEqual(again, first);
  assert.equal((await store.list()).length, 1);
});

test("remove reports whether the editor was listed", async () => {
  const store = newStore();
  await store.add("editor@example.com", "admin@example.com");

  assert.equal(await store.remove("editor@example.com"), true);
  assert.equal(await store.remove("editor@example.com"), false);
  assert.equal(await store.has("editor@example.com"), false);
});
