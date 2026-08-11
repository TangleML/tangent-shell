import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("recordAgent round-trips a connector descriptor", async () => {
  const store = newStore();
  const session = await store.createSession({ name: "S" });

  const recorded = await store.recordAgent(session.id, {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
    host: "remote",
    connector: {
      kind: "remote-env",
      lifecycle: "owned",
      spawnAuthority: "remote-env",
      environmentId: "env-1",
    },
  });

  const expected = {
    kind: "remote-env",
    lifecycle: "owned",
    spawnAuthority: "remote-env",
    environmentId: "env-1",
  };
  assert.deepEqual(recorded.connector, expected);
  const agents = await store.listAgents(session.id);
  assert.deepEqual(agents.find((a) => a.id === "sub-1")?.connector, expected);
});

test("a row recorded without a connector reads back from its host", async () => {
  const store = newStore();
  const session = await store.createSession({ name: "S" });

  // Exactly the shape of a row written before the connector columns existed:
  // `host` set, connector columns null.
  const recorded = await store.recordAgent(session.id, {
    id: "legacy",
    role: "subagent",
    name: "Old",
    host: "remote",
  });

  assert.deepEqual(recorded.connector, {
    kind: "remote-env",
    lifecycle: "owned",
    spawnAuthority: "remote-env",
  });

  // Prime is recorded by `createSession` with no host at all.
  const prime = (await store.listAgents(session.id)).find(
    (a) => a.id === "prime",
  );
  assert.equal(prime?.connector.kind, "pi-stdio");
});

test("a completed sub-agent stays completed, rather than collapsing to killed", async () => {
  const store = newStore();
  const session = await store.createSession({ name: "S" });
  await store.recordAgent(session.id, {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
  });

  await store.setAgentStatus(session.id, "sub-1", "completed");

  const agents = await store.listAgents(session.id);
  assert.equal(agents.find((a) => a.id === "sub-1")?.status, "completed");
});

test("detachActiveSubagents marks live sub-agents detached and leaves the rest", async () => {
  const store = newStore();
  const session = await store.createSession({ name: "S" });
  for (const [id, status] of [
    ["live", "active"],
    ["already", "detached"],
    ["done", "completed"],
    ["gone", "killed"],
    ["broken", "error"],
  ] as const) {
    await store.recordAgent(session.id, {
      id,
      role: "subagent",
      name: id,
      status,
    });
  }

  const detached = await store.detachActiveSubagents();

  // Only the row claiming to be live changes; the terminal ones are history and
  // the already-detached one needs nothing done to it.
  assert.equal(detached, 1);
  const byId = new Map(
    (await store.listAgents(session.id)).map((a) => [a.id, a.status]),
  );
  assert.equal(byId.get("live"), "detached");
  assert.equal(byId.get("already"), "detached");
  assert.equal(byId.get("done"), "completed");
  assert.equal(byId.get("gone"), "killed");
  assert.equal(byId.get("broken"), "error");
  // Prime is the process manager's to ensure, not this reconciliation's.
  assert.equal(byId.get("prime"), "active");
});

test("listAgentsForEnvironment finds one environment's sub-agents across sessions", async () => {
  const store = newStore();
  const a = await store.createSession({ name: "A" });
  const b = await store.createSession({ name: "B" });
  const remote = (id: string, environmentId: string) => ({
    id,
    role: "subagent" as const,
    name: id,
    host: "remote" as const,
    connector: {
      kind: "remote-env" as const,
      lifecycle: "owned" as const,
      spawnAuthority: "remote-env" as const,
      environmentId,
    },
  });
  await store.recordAgent(a.id, remote("mine-a", "env-1"));
  await store.recordAgent(b.id, remote("mine-b", "env-1"));
  await store.recordAgent(a.id, remote("theirs", "env-2"));
  // A row written before the connector columns existed records no environment.
  await store.recordAgent(a.id, {
    id: "legacy",
    role: "subagent",
    name: "legacy",
    host: "remote",
  });

  const found = await store.listAgentsForEnvironment("env-1");

  assert.deepEqual(
    found.map((agent) => [agent.id, agent.sessionId]).sort(),
    [
      ["mine-a", a.id],
      ["mine-b", b.id],
    ].sort(),
  );
});

test("nextSeq is monotonic within a conversation", async () => {
  const store = newStore();
  const session = await store.createSession({ name: "S" });

  const allocated = [
    await store.nextSeq(session.id, "prime"),
    await store.nextSeq(session.id, "prime"),
    await store.nextSeq(session.id, "prime"),
  ];

  assert.deepEqual(allocated, [1, 2, 3]);
});

test("each conversation gets its own sequence", async () => {
  const store = newStore();
  const session = await store.createSession({ name: "S" });

  await store.nextSeq(session.id, "prime");
  await store.nextSeq(session.id, "prime");

  assert.equal(
    await store.nextSeq(session.id, "sub-1"),
    1,
    "a sub-agent's thread starts at 1 regardless of Prime's",
  );
  assert.equal(await store.nextSeq(session.id, "prime"), 3);
});

test("nextSeq seeds above a transcript written before seq existed", async () => {
  const store = newStore();
  const session = await store.createSession({ name: "S" });

  // Two lines carrying no envelope, exactly as an older build would have left
  // them. They read back as seq 1 and 2, so allocation must start at 3.
  const dir = path.join(session.rootPath, ".tangent", "chats");
  mkdirSync(dir, { recursive: true });
  const legacy = (id: string) =>
    `${JSON.stringify({
      id,
      sessionId: session.id,
      conversationId: "prime",
      author: { id: "u", kind: "human", name: "You" },
      content: id,
      createdAt: "2026-01-01T00:00:00.000Z",
    })}\n`;
  writeFileSync(
    path.join(dir, "prime.jsonl"),
    `${legacy("old-1")}${legacy("old-2")}`,
  );

  assert.equal(await store.nextSeq(session.id, "prime"), 3);
  assert.equal(await store.nextSeq(session.id, "prime"), 4);
});

test("deleting a session cascades its read state", async () => {
  const store = newStore();
  const session = await store.createSession({ name: "S" });
  await store.markViewed(session.id, "a@x", "2026-01-01T00:00:00.000Z");

  await store.deleteSession(session.id);
  assert.equal((await store.getLastViewedMap("a@x")).size, 0);
});
