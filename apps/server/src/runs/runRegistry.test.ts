import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir before importing modules that read
// config at load time, so creating a session never touches the repo.
const ROOT = mkdtempSync(path.join(tmpdir(), "run-registry-"));
process.env.SESSIONS_ROOT = ROOT;

const { openDb } = await import("../store/db/client.ts");
const { SqliteRunStore } = await import("../store/sqliteRunStore.ts");
const { SqliteSessionStore } = await import("../store/sqliteSessionStore.ts");
const { RunRegistry } = await import("./runRegistry.ts");

after(() => rmSync(ROOT, { recursive: true, force: true }));

/**
 * A registry over a fresh in-memory DB, plus the session its runs hang off:
 * `runs.session_id` is a real foreign key, so a run needs a real session.
 */
async function newRegistry() {
  const db = openDb(":memory:");
  const store = new SqliteRunStore(db);
  const session = await new SqliteSessionStore(db).createSession({ name: "S" });
  return { runs: new RunRegistry(store), store, sessionId: session.id };
}

/** Yields to the microtask queue so write-through persistence has landed. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("opening a run persists it as running and makes it current", async () => {
  const h = await newRegistry();

  const run = h.runs.open({
    sessionId: h.sessionId,
    participantId: "prime",
    ingress: "reaction",
  });
  await flush();

  assert.equal(run.status, "running");
  assert.equal(run.homeConversationId, "prime");
  assert.equal(h.runs.current(h.sessionId, "prime")?.id, run.id);
  assert.equal(h.runs.get(run.id)?.id, run.id);
  const stored = await h.store.getRun(run.id);
  assert.equal(stored?.status, "running");
  assert.equal(stored?.ingress, "reaction");
  assert.equal(stored?.endedAt, undefined);
});

test("a participant has one run at a time: opening settles the previous", async () => {
  const h = await newRegistry();

  const first = h.runs.open({
    sessionId: h.sessionId,
    participantId: "prime",
    ingress: "reaction",
  });
  const second = h.runs.open({
    sessionId: h.sessionId,
    participantId: "prime",
    ingress: "schedule",
  });
  await flush();

  assert.equal(h.runs.current(h.sessionId, "prime")?.id, second.id);
  assert.equal(h.runs.get(first.id), undefined);
  assert.equal((await h.store.getRun(first.id))?.status, "completed");
  assert.equal((await h.store.getRun(second.id))?.status, "running");
});

test("runs are per participant, not per session", async () => {
  const h = await newRegistry();

  const prime = h.runs.open({
    sessionId: h.sessionId,
    participantId: "prime",
    ingress: "reaction",
  });
  const worker = h.runs.open({
    sessionId: h.sessionId,
    participantId: "worker-1",
    ingress: "tool",
  });

  assert.equal(h.runs.current(h.sessionId, "prime")?.id, prime.id);
  assert.equal(h.runs.current(h.sessionId, "worker-1")?.id, worker.id);
});

test("settling records which terminal state a run reached", async () => {
  const h = await newRegistry();

  const run = h.runs.open({
    sessionId: h.sessionId,
    participantId: "prime",
    ingress: "reaction",
  });
  h.runs.settle(run.id, "cancelled");
  await flush();

  assert.equal(h.runs.current(h.sessionId, "prime"), undefined);
  const stored = await h.store.getRun(run.id);
  assert.equal(stored?.status, "cancelled");
  assert.ok(stored?.endedAt);
});

test("a connector's cursor and external id round-trip through the store", async () => {
  const h = await newRegistry();

  const run = h.runs.open({
    sessionId: h.sessionId,
    participantId: "worker-1",
    ingress: "tool",
    externalId: "aquifer-session-1",
    cursor: "0",
  });
  h.runs.setCursor(run.id, "42");
  h.runs.setExternalId(run.id, "aquifer-session-2");
  await flush();

  assert.equal(h.runs.current(h.sessionId, "worker-1")?.cursor, "42");
  const stored = await h.store.getRun(run.id);
  assert.equal(stored?.cursor, "42");
  assert.equal(stored?.externalId, "aquifer-session-2");
});

test("failStaleRuns settles runs a previous process left running", async () => {
  const h = await newRegistry();

  const run = h.runs.open({
    sessionId: h.sessionId,
    participantId: "prime",
    ingress: "reaction",
  });
  await flush();

  // A fresh registry over the same store is the next process: it holds nothing
  // in memory, so the row is residue.
  const next = new RunRegistry(h.store);
  assert.equal(await next.failStaleRuns(), 1);

  const stored = await h.store.getRun(run.id);
  assert.equal(stored?.status, "failed");
  assert.ok(stored?.endedAt);
  assert.equal(await next.failStaleRuns(), 0);
});

test("settling an unknown run is a no-op", async () => {
  const h = await newRegistry();

  h.runs.settle("no-such-run", "completed");
  h.runs.settleOpenFor(h.sessionId, "prime", "completed");

  assert.equal(h.runs.get("no-such-run"), undefined);
});
