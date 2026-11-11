import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionUsage, UsageTotals } from "@tangent/shared/contracts.ts";
import type { Response } from "express";

import { InMemoryRunStore } from "../../store/inMemoryRunStore.ts";
import { InMemorySessionStore } from "../../store/inMemorySessionStore.ts";
import { InMemoryUsageStore } from "../../store/inMemoryUsageStore.ts";
import { handleGetSessionUsage } from "./handlers.ts";

class TestResponse {
  statusCode = 200;
  body: unknown;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): this {
    this.body = body;
    return this;
  }
}

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

/** Seeds a session with two agents, one run, and usage against each. */
async function seedSession() {
  const store = new InMemorySessionStore();
  const runStore = new InMemoryRunStore();
  const usageStore = new InMemoryUsageStore();

  const session = await store.createSession({ name: "S" });
  await store.recordAgent(session.id, {
    id: "prime",
    role: "prime",
    name: "Prime",
  });
  await store.recordAgent(session.id, {
    id: "worker-1",
    role: "subagent",
    name: "Worker",
    purpose: "Crunch the CSV",
  });
  await runStore.createRun({
    id: "run-a",
    sessionId: session.id,
    participantId: "worker-1",
    homeConversationId: "worker-1",
    ingress: "tool",
  });
  await usageStore.record({
    sessionId: session.id,
    agentId: "prime",
    usage: totals({ inputTokens: 100, totalTokens: 100, costUsd: 0.01 }),
  });
  await usageStore.record({
    sessionId: session.id,
    agentId: "worker-1",
    runId: "run-a",
    usage: totals({ outputTokens: 40, totalTokens: 40, costUsd: 0.04 }),
  });
  return { store, runStore, usageStore, sessionId: session.id };
}

/** Resolves the `SessionUsage` the endpoint writes for `sessionId`. */
async function fetchUsage(deps: Awaited<ReturnType<typeof seedSession>>) {
  const res = new TestResponse();
  await handleGetSessionUsage(
    deps.store,
    deps.usageStore,
    deps.runStore,
    deps.sessionId,
    res as unknown as Response,
  );
  return (res.body as { usage: SessionUsage }).usage;
}

test("the usage endpoint totals a session and names each agent", async () => {
  const deps = await seedSession();
  const usage = await fetchUsage(deps);

  assert.equal(usage.sessionId, deps.sessionId);
  assert.equal(usage.total.totalTokens, 140);
  assert.equal(Number(usage.total.costUsd.toFixed(4)), 0.05);

  const worker = usage.byAgent.find((agent) => agent.agentId === "worker-1");
  assert.ok(worker, "the worker appears in the per-agent breakdown");
  assert.equal(worker.name, "Worker");
  assert.equal(worker.purpose, "Crunch the CSV");
  assert.equal(worker.role, "subagent");
  assert.equal(worker.totals.totalTokens, 40);
});

test("the usage endpoint breaks spend down by run", async () => {
  const deps = await seedSession();
  const usage = await fetchUsage(deps);

  assert.equal(usage.byRun.length, 1);
  const [run] = usage.byRun;
  assert.ok(run, "the run appears in the per-run breakdown");
  assert.equal(run.runId, "run-a");
  assert.equal(run.ingress, "tool");
  assert.equal(run.participantId, "worker-1");
});

test("the usage endpoint 404s for an unknown session", async () => {
  const store = new InMemorySessionStore();
  const res = new TestResponse();

  await handleGetSessionUsage(
    store,
    new InMemoryUsageStore(),
    new InMemoryRunStore(),
    "nope",
    res as unknown as Response,
  );

  assert.equal(res.statusCode, 404);
});
