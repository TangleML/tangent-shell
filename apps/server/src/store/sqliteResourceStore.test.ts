import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir before importing modules that read
// config at load time, so `createSession`'s mkdir never touches the repo.
const ROOT = mkdtempSync(path.join(tmpdir(), "resource-store-"));
process.env.SESSIONS_ROOT = ROOT;

const { openDb } = await import("./db/client.ts");
const { SqliteResourceStore } = await import("./sqliteResourceStore.ts");
const { SqliteSessionStore } = await import("./sqliteSessionStore.ts");

after(() => rmSync(ROOT, { recursive: true, force: true }));

/** A fresh in-memory DB with a session row the resources can hang off of. */
async function fixture() {
  const db = openDb(":memory:");
  const sessions = new SqliteSessionStore(db);
  const resources = new SqliteResourceStore(db);
  const session = await sessions.createSession({ name: "S" });
  return { sessions, resources, sessionId: session.id };
}

test("catalog dedupes by (session, uri), refreshing in place", async () => {
  const { resources, sessionId } = await fixture();

  const first = await resources.catalog({
    sessionId,
    kind: "artifact",
    name: "Report",
    uri: "artifacts/report.html",
  });
  const second = await resources.catalog({
    sessionId,
    kind: "artifact",
    name: "Report (v2)",
    uri: "artifacts/report.html",
  });

  // Same uri keeps the id and createdAt; the mutable fields are refreshed.
  assert.equal(second.id, first.id);
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.name, "Report (v2)");

  const all = await resources.listForSession(sessionId);
  assert.equal(all.length, 1);
});

test("meta round-trips through the JSON column", async () => {
  const { resources, sessionId } = await fixture();

  await resources.catalog({
    sessionId,
    kind: "attachment",
    name: "data.csv",
    uri: "uploads/data.csv",
    authorParticipantId: "prime",
    meta: { contentType: "text/csv", size: 42 },
  });

  const [read] = await resources.listForSession(sessionId);
  assert.equal(read.authorParticipantId, "prime");
  assert.deepEqual(read.meta, { contentType: "text/csv", size: 42 });
});

test("reference dedupes by (conversation, resource) and scopes by conversation", async () => {
  const { resources, sessionId } = await fixture();
  const resource = await resources.catalog({
    sessionId,
    kind: "artifact",
    name: "Report",
    uri: "artifacts/report.html",
  });

  await resources.reference({
    sessionId,
    conversationId: "c1",
    resourceId: resource.id,
  });
  await resources.reference({
    sessionId,
    conversationId: "c1",
    resourceId: resource.id,
  });

  const inC1 = await resources.listForConversation(sessionId, "c1");
  assert.equal(inC1.length, 1);
  assert.equal(inC1[0].id, resource.id);

  // A conversation with no reference to it sees nothing — a reference surfaces
  // content in one thread, not the whole session.
  const inC2 = await resources.listForConversation(sessionId, "c2");
  assert.equal(inC2.length, 0);
});

test("remove drops the resource and cascades its references", async () => {
  const { resources, sessionId } = await fixture();
  const resource = await resources.catalog({
    sessionId,
    kind: "artifact",
    name: "Report",
    uri: "artifacts/report.html",
  });
  await resources.reference({
    sessionId,
    conversationId: "c1",
    resourceId: resource.id,
  });

  await resources.remove(sessionId, "artifacts/report.html");

  assert.equal((await resources.listForSession(sessionId)).length, 0);
  assert.equal(
    (await resources.listForConversation(sessionId, "c1")).length,
    0,
  );
});

test("deleting a session cascades its resources", async () => {
  const { sessions, resources, sessionId } = await fixture();
  await resources.catalog({
    sessionId,
    kind: "artifact",
    name: "Report",
    uri: "artifacts/report.html",
  });

  await sessions.deleteSession(sessionId);

  assert.equal((await resources.listForSession(sessionId)).length, 0);
});
