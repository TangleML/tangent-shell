import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir before importing modules that read
// config at load time.
const ROOT = mkdtempSync(path.join(tmpdir(), "migration-0012-"));
process.env.SESSIONS_ROOT = ROOT;

const { openDb } = await import("./client.ts");
const { SqliteSessionStore } = await import("../sqliteSessionStore.ts");
const { SqliteParticipantStore } = await import("../sqliteParticipantStore.ts");

after(() => rmSync(ROOT, { recursive: true, force: true }));

test("0012 adds a nullable revoked_at without touching existing rows", async () => {
  const db = openDb(":memory:");
  const store = new SqliteParticipantStore(db);
  // createSession dual-writes a `prime` participant with no revoked_at set —
  // exactly the shape a row backfilled before 0012 has.
  const session = await new SqliteSessionStore(db, store).createSession({
    name: "S",
  });

  const prime = await store.get(session.id, "prime");
  assert.ok(prime, "the pre-existing participant still reads back");
  assert.equal(prime.revokedAt, undefined, "a legacy row is not revoked");

  const columns = db.$client
    .prepare("PRAGMA table_info(participants)")
    .all() as { name: string; notnull: number }[];
  const revoked = columns.find((column) => column.name === "revoked_at");
  assert.ok(revoked, "the migration added the column");
  assert.equal(revoked.notnull, 0, "and left it nullable");
});
