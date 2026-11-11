import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { UsageTotals } from "@tangent/shared/contracts.ts";

// Point the session root at a throwaway dir before importing modules that read
// config at load time.
const ROOT = mkdtempSync(path.join(tmpdir(), "usage-store-"));
process.env.SESSIONS_ROOT = ROOT;

const { openDb } = await import("./db/client.ts");
const { SqliteSessionStore } = await import("./sqliteSessionStore.ts");
const { SqliteUsageStore } = await import("./sqliteUsageStore.ts");

after(() => rmSync(ROOT, { recursive: true, force: true }));

/** A usage store over a fresh db, plus the session its rows reference. */
async function newStore() {
  const db = openDb(":memory:");
  const sessions = new SqliteSessionStore(db);
  const session = await sessions.createSession({ name: "S" });
  return { store: new SqliteUsageStore(db), sessionId: session.id };
}

/** Token totals with sane defaults, overridable per field. */
function totals(overrides: Partial<UsageTotals>): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    ...overrides,
  };
}

test("summarize sums every event into the session total", async () => {
  const { store, sessionId } = await newStore();
  await store.record({
    sessionId,
    agentId: "prime",
    usage: totals({ inputTokens: 100, totalTokens: 100, costUsd: 0.01 }),
  });
  await store.record({
    sessionId,
    agentId: "prime",
    usage: totals({ outputTokens: 50, totalTokens: 50, costUsd: 0.02 }),
  });

  const { total } = await store.summarize(sessionId);
  assert.equal(total.inputTokens, 100);
  assert.equal(total.outputTokens, 50);
  assert.equal(total.totalTokens, 150);
  assert.equal(Number(total.costUsd.toFixed(4)), 0.03);
});

test("summarize groups by agent and by run", async () => {
  const { store, sessionId } = await newStore();
  await store.record({
    sessionId,
    agentId: "prime",
    runId: "run-a",
    usage: totals({ totalTokens: 10, costUsd: 0.1 }),
  });
  await store.record({
    sessionId,
    agentId: "worker-1",
    runId: "run-b",
    usage: totals({ totalTokens: 30, costUsd: 0.3 }),
  });
  await store.record({
    sessionId,
    agentId: "worker-1",
    runId: "run-b",
    usage: totals({ totalTokens: 5, costUsd: 0.05 }),
  });

  const { byAgent, byRun } = await store.summarize(sessionId);

  const agents = new Map(byAgent.map((row) => [row.agentId, row.totals]));
  assert.equal(agents.get("prime")?.totalTokens, 10);
  assert.equal(agents.get("worker-1")?.totalTokens, 35);

  const runs = new Map(byRun.map((row) => [row.runId, row.totals]));
  assert.equal(runs.get("run-a")?.totalTokens, 10);
  assert.equal(runs.get("run-b")?.totalTokens, 35);
});

test("a run-less event joins the total and agent, not any run bucket", async () => {
  const { store, sessionId } = await newStore();
  await store.record({
    sessionId,
    agentId: "prime",
    usage: totals({ totalTokens: 7, costUsd: 0.07 }),
  });

  const { total, byAgent, byRun } = await store.summarize(sessionId);
  assert.equal(total.totalTokens, 7);
  assert.equal(byAgent[0]?.totals.totalTokens, 7);
  assert.deepEqual(byRun, []);
});

test("summarize of a session with no events is all zeros", async () => {
  const { store, sessionId } = await newStore();
  const { total, byAgent, byRun } = await store.summarize(sessionId);
  assert.deepEqual(total, totals({}));
  assert.deepEqual(byAgent, []);
  assert.deepEqual(byRun, []);
});
