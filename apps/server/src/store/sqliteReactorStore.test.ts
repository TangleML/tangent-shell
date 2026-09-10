import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { ReactorRecord } from "@tangent/shared/contracts.ts";

// Point the session root at a throwaway dir before importing modules that read
// config at load time.
const ROOT = mkdtempSync(path.join(tmpdir(), "reactor-store-"));
process.env.SESSIONS_ROOT = ROOT;

const { openDb } = await import("./db/client.ts");
const { SqliteSessionStore } = await import("./sqliteSessionStore.ts");
const { SqliteReactorStore } = await import("./sqliteReactorStore.ts");

after(() => rmSync(ROOT, { recursive: true, force: true }));

/** A reactor store plus a live db and the session its rows reference. */
async function newStore() {
  const db = openDb(":memory:");
  const sessions = new SqliteSessionStore(db);
  const session = await sessions.createSession({ name: "S" });
  return { db, store: new SqliteReactorStore(db), sessionId: session.id };
}

function reactor(
  overrides: Partial<ReactorRecord> & { sessionId: string },
): ReactorRecord {
  const now = new Date().toISOString();
  return {
    id: "r1",
    participantId: "prime",
    homeConversationId: "A",
    spec: { name: "awaitAll", participants: ["w1", "w2", "w3"] },
    scope: {
      memberships: [
        { conversationId: "B1", participantId: "prime" },
        { conversationId: "B2", participantId: "prime" },
        { conversationId: "B3", participantId: "prime" },
      ],
      homeConversationId: "A",
    },
    state: { kind: "await", seen: [] },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("a reactor's folded state survives a reload into a new store", async () => {
  const { db, store, sessionId } = await newStore();
  await store.put(
    reactor({ sessionId, state: { kind: "await", seen: ["w1", "w2"] } }),
  );

  // A fresh store over the same db is the "new process" the state must outlive.
  const reloaded = await new SqliteReactorStore(db).get("r1");
  assert.deepEqual(reloaded?.state, { kind: "await", seen: ["w1", "w2"] });
  assert.deepEqual(reloaded?.spec, {
    name: "awaitAll",
    participants: ["w1", "w2", "w3"],
  });
  assert.deepEqual(reloaded?.scope.homeConversationId, "A");
});

test("put upserts on the scope key rather than stacking a duplicate join", async () => {
  const { store, sessionId } = await newStore();
  await store.put(reactor({ sessionId, state: { kind: "await", seen: [] } }));

  await store.put(
    reactor({ sessionId, id: "r2", state: { kind: "await", seen: ["w1"] } }),
  );

  const rows = await store.listForSession(sessionId);
  assert.equal(rows.length, 1, "the same scope edits its row in place");
  assert.deepEqual(rows[0].state, { kind: "await", seen: ["w1"] });
});

test("listObserving finds a reactor by a conversation in its scope", async () => {
  const { store, sessionId } = await newStore();
  await store.put(reactor({ sessionId }));

  assert.equal((await store.listObserving(sessionId, "B2")).length, 1);
  assert.deepEqual(await store.listObserving(sessionId, "elsewhere"), []);
});

test("remove deletes a reactor", async () => {
  const { store, sessionId } = await newStore();
  await store.put(reactor({ sessionId }));

  await store.remove("r1");

  assert.equal(await store.get("r1"), undefined);
  assert.deepEqual(await store.listForSession(sessionId), []);
});
