import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir before importing modules that read
// config at load time, so creating a session never touches the repo.
const ROOT = mkdtempSync(path.join(tmpdir(), "trigger-delegations-"));
process.env.SESSIONS_ROOT = ROOT;

const { openDb } = await import("./db/client.ts");
const { SqliteSessionStore } = await import("./sqliteSessionStore.ts");
const { SqliteTriggerDelegationStore } =
  await import("./sqliteTriggerDelegationStore.ts");

after(() => rmSync(ROOT, { recursive: true, force: true }));

async function newStore() {
  const db = openDb(":memory:");
  const sessions = new SqliteSessionStore(db);
  const session = await sessions.createSession({ name: "S" });
  return {
    tokens: new SqliteTriggerDelegationStore(db),
    sessions,
    sessionId: session.id,
  };
}

test("a trigger's delegation round-trips, is replaced in place, and can be deleted", async () => {
  const h = await newStore();
  const first = {
    sessionId: h.sessionId,
    triggerId: "t1",
    participantId: "alice@x",
    delegationId: "d1",
    token: "token-1",
  };

  h.tokens.put(first);
  assert.deepEqual(h.tokens.get(h.sessionId, "t1"), first);
  assert.equal(h.tokens.get(h.sessionId, "t2"), undefined);

  h.tokens.put({ ...first, delegationId: "d2", token: "token-2" });
  assert.equal(h.tokens.get(h.sessionId, "t1")?.token, "token-2");

  h.tokens.delete(h.sessionId, "t1");
  assert.equal(h.tokens.get(h.sessionId, "t1"), undefined);
  h.tokens.delete(h.sessionId, "t1");
});

test("deleting the session takes its delegation tokens with it", async () => {
  const h = await newStore();
  h.tokens.put({
    sessionId: h.sessionId,
    triggerId: "t1",
    participantId: "alice@x",
    delegationId: "d1",
    token: "token-1",
  });

  await h.sessions.deleteSession(h.sessionId);
  assert.equal(h.tokens.get(h.sessionId, "t1"), undefined);
});
