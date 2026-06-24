import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir before importing modules that read
// config at load time, so `createSession`'s mkdir never touches the repo.
const ROOT = mkdtempSync(path.join(tmpdir(), "session-store-"));
process.env.SESSIONS_ROOT = ROOT;

const { openDb } = await import("./db/client.ts");
const { SqliteSessionStore } = await import("./sqliteSessionStore.ts");

after(() => rmSync(ROOT, { recursive: true, force: true }));

/** A store backed by a fresh in-memory DB with migrations applied. */
function newStore() {
  return new SqliteSessionStore(openDb(":memory:"));
}

test("getLastViewedMap is empty before anything is viewed", async () => {
  const store = newStore();
  const session = await store.createSession({ name: "S" });
  const map = await store.getLastViewedMap("a@example.com");
  assert.equal(map.size, 0);
  assert.equal(map.get(session.id), undefined);
});

test("markViewed upserts and isolates read state per user", async () => {
  const store = newStore();
  const session = await store.createSession({ name: "S" });

  await store.markViewed(session.id, "a@x", "2026-01-01T00:00:00.000Z");
  await store.markViewed(session.id, "b@x", "2026-02-01T00:00:00.000Z");

  assert.equal(
    (await store.getLastViewedMap("a@x")).get(session.id),
    "2026-01-01T00:00:00.000Z",
  );
  assert.equal(
    (await store.getLastViewedMap("b@x")).get(session.id),
    "2026-02-01T00:00:00.000Z",
  );

  // Re-viewing the same (session, user) overwrites rather than duplicating.
  await store.markViewed(session.id, "a@x", "2026-03-01T00:00:00.000Z");
  const a = await store.getLastViewedMap("a@x");
  assert.equal(a.size, 1);
  assert.equal(a.get(session.id), "2026-03-01T00:00:00.000Z");
});

test("deleting a session cascades its read state", async () => {
  const store = newStore();
  const session = await store.createSession({ name: "S" });
  await store.markViewed(session.id, "a@x", "2026-01-01T00:00:00.000Z");

  await store.deleteSession(session.id);
  assert.equal((await store.getLastViewedMap("a@x")).size, 0);
});
