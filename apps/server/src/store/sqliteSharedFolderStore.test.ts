import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session + shared roots at throwaway dirs before importing modules
// that read config at load time, so the mkdirs never touch the repo.
const ROOT = mkdtempSync(path.join(tmpdir(), "shared-store-sess-"));
const SHARED = mkdtempSync(path.join(tmpdir(), "shared-store-"));
process.env.SESSIONS_ROOT = ROOT;
process.env.SHARED_ROOT = SHARED;

const { openDb } = await import("./db/client.ts");
const { SqliteSharedFolderStore } =
  await import("./sqliteSharedFolderStore.ts");
const { sharedFolderPath } = await import("./sharedFolderStore.ts");

after(() => {
  rmSync(ROOT, { recursive: true, force: true });
  rmSync(SHARED, { recursive: true, force: true });
});

function fixture() {
  return new SqliteSharedFolderStore(openDb(":memory:"));
}

test("createSharedFolder persists a row and makes its backing directory", async () => {
  const store = fixture();

  const folder = await store.createSharedFolder({ name: "Project X" });

  assert.equal(folder.name, "Project X");
  assert.match(folder.id, /[0-9a-f-]{36}/);
  assert.equal(existsSync(sharedFolderPath(folder.id)), true);

  const fetched = await store.getSharedFolder(folder.id);
  assert.deepEqual(fetched, folder);
});

test("a blank name falls back to a generated label", async () => {
  const store = fixture();

  const first = await store.createSharedFolder({});
  const second = await store.createSharedFolder({ name: "   " });

  assert.equal(first.name, "Shared folder 1");
  assert.equal(second.name, "Shared folder 2");
});

test("listSharedFolders returns every created folder", async () => {
  const store = fixture();
  const a = await store.createSharedFolder({ name: "A" });
  const b = await store.createSharedFolder({ name: "B" });

  const ids = (await store.listSharedFolders()).map((folder) => folder.id);
  assert.equal(ids.length, 2);
  assert.deepEqual(new Set(ids), new Set([a.id, b.id]));
});

test("getSharedFolder returns undefined for an unknown id", async () => {
  const store = fixture();
  assert.equal(await store.getSharedFolder("nope"), undefined);
});
