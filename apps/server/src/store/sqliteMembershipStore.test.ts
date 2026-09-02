import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { Membership } from "./membershipStore.ts";

// Point the session root at a throwaway dir before importing modules that read
// config at load time.
const ROOT = mkdtempSync(path.join(tmpdir(), "membership-store-"));
process.env.SESSIONS_ROOT = ROOT;

const { openDb } = await import("./db/client.ts");
const { SqliteSessionStore } = await import("./sqliteSessionStore.ts");
const { SqliteMembershipStore } = await import("./sqliteMembershipStore.ts");

after(() => rmSync(ROOT, { recursive: true, force: true }));

/** A membership store plus the session store its rows reference. */
async function newStore() {
  const db = openDb(":memory:");
  const sessions = new SqliteSessionStore(db);
  const session = await sessions.createSession({ name: "S" });
  return { store: new SqliteMembershipStore(db), sessionId: session.id };
}

function membership(overrides: Partial<Membership> & { sessionId: string }) {
  return {
    participantId: "prime",
    conversationId: "sub-1",
    reaction: "atRunEnd+mentionsMe",
    ingress: "reaction",
    admission: "queue",
    transcriptVisibility: "shared",
    ...overrides,
  } satisfies Membership;
}

test("a membership round-trips through the table", async () => {
  const { store, sessionId } = await newStore();
  const row = membership({ sessionId });

  await store.put(row);

  assert.deepEqual(await store.listForSession(sessionId), [row]);
});

test("put upserts on (session, conversation, participant)", async () => {
  const { store, sessionId } = await newStore();
  await store.put(membership({ sessionId }));

  await store.put(membership({ sessionId, reaction: "never" }));

  const rows = await store.listForSession(sessionId);
  assert.equal(rows.length, 1, "re-declaring a membership edits it");
  assert.equal(rows[0].reaction, "never");
});

test("a membership's admission policy round-trips and upserts", async () => {
  const { store, sessionId } = await newStore();
  await store.put(membership({ sessionId, admission: "coalesce" }));

  assert.equal(
    (await store.listForSession(sessionId))[0].admission,
    "coalesce",
  );

  await store.put(membership({ sessionId, admission: "preempt" }));
  assert.equal((await store.listForSession(sessionId))[0].admission, "preempt");
});

test("one participant holds a membership per conversation", async () => {
  const { store, sessionId } = await newStore();

  await store.put(membership({ sessionId, conversationId: "prime" }));
  await store.put(membership({ sessionId, conversationId: "sub-1" }));

  const rows = await store.listForSession(sessionId);
  assert.deepEqual(rows.map((r) => r.conversationId).sort(), [
    "prime",
    "sub-1",
  ]);
});

test("memberships are scoped to their session", async () => {
  const { store, sessionId } = await newStore();
  await store.put(membership({ sessionId }));

  // A participant id is only unique within a session, which is why the row
  // carries one at all.
  assert.deepEqual(await store.listForSession("other-session"), []);
});

test("deleting a session takes its memberships with it", async () => {
  const db = openDb(":memory:");
  const sessions = new SqliteSessionStore(db);
  const store = new SqliteMembershipStore(db);
  const session = await sessions.createSession({ name: "S" });
  await store.put(membership({ sessionId: session.id }));

  await sessions.deleteSession(session.id);

  assert.deepEqual(await store.listForSession(session.id), []);
});

test("get returns one membership by its full key, or nothing", async () => {
  const { store, sessionId } = await newStore();
  await store.put(membership({ sessionId, conversationId: "sub-1" }));

  assert.deepEqual(await store.get(sessionId, "sub-1", "prime"), {
    ...membership({ sessionId, conversationId: "sub-1" }),
  });
  assert.equal(await store.get(sessionId, "sub-1", "nobody"), undefined);
  assert.equal(await store.get(sessionId, "other", "prime"), undefined);
});

test("listForConversation returns only that conversation's members", async () => {
  const { store, sessionId } = await newStore();
  await store.put(
    membership({ sessionId, conversationId: "sub-1", participantId: "sub-1" }),
  );
  await store.put(
    membership({ sessionId, conversationId: "sub-1", participantId: "prime" }),
  );
  await store.put(
    membership({ sessionId, conversationId: "prime", participantId: "prime" }),
  );

  const members = await store.listForConversation(sessionId, "sub-1");
  assert.deepEqual(members.map((m) => m.participantId).sort(), [
    "prime",
    "sub-1",
  ]);
});

test("remove deletes one membership and no-ops when absent", async () => {
  const { store, sessionId } = await newStore();
  await store.put(membership({ sessionId, conversationId: "sub-1" }));

  await store.remove(sessionId, "sub-1", "prime");
  assert.deepEqual(await store.listForSession(sessionId), []);

  await store.remove(sessionId, "sub-1", "prime");
});
