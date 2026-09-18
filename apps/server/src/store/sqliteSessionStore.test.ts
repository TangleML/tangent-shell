import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

// Point the session root at a throwaway dir before importing modules that read
// config at load time, so `createSession`'s mkdir never touches the repo.
const ROOT = mkdtempSync(path.join(tmpdir(), "session-store-"));
process.env.SESSIONS_ROOT = ROOT;

const { connectorFor } = await import("@tangent/shared/contracts.ts");
const { sql } = await import("drizzle-orm");
const { openDb } = await import("./db/client.ts");
const { SqliteParticipantStore } = await import("./sqliteParticipantStore.ts");
const { SqliteResourceStore } = await import("./sqliteResourceStore.ts");
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

/** The `agent_id` backfill statement drizzle-kit's 0013 migration appended. */
function agentIdBackfillStatement(): string {
  const file = fileURLToPath(
    new URL("./db/migrations/0013_chief_veda.sql", import.meta.url),
  );
  const statement = readFileSync(file, "utf8")
    .split("--> statement-breakpoint")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith("UPDATE `conversations`"));
  assert.ok(statement, "0013 carries an agent_id backfill statement");
  return statement;
}

test("recordAgent mints a fresh home conversation for a new agent id", async () => {
  const store = newStore();
  const session = await store.createSession({ name: "S" });

  const recorded = await store.recordAgent(session.id, {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
    connector: connectorFor("pi-stdio"),
  });

  assert.notEqual(
    recorded.homeConversationId,
    "sub-1",
    "a Conversation id no longer names the agent that owns it",
  );
  // Idempotent: re-recording (a revive) resolves the same id, never re-mints.
  const again = await store.recordAgent(session.id, {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
    status: "active",
    connector: connectorFor("pi-stdio"),
  });
  assert.equal(again.homeConversationId, recorded.homeConversationId);
  const agents = await store.listAgents(session.id);
  assert.equal(
    agents.find((a) => a.id === "sub-1")?.homeConversationId,
    recorded.homeConversationId,
    "listAgents resolves the same mapping",
  );
});

test("recordAgent honors a spawner-supplied home conversation id", async () => {
  const store = newStore();
  const session = await store.createSession({ name: "S" });

  const recorded = await store.recordAgent(session.id, {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
    homeConversationId: "conv-abc",
    connector: connectorFor("pi-stdio"),
  });

  assert.equal(recorded.homeConversationId, "conv-abc");
});

test("a legacy <agentId>.jsonl keeps the agent id as its home conversation", async () => {
  const store = newStore();
  const session = await store.createSession({ name: "S" });

  // A transcript an older build left keyed by the agent's own id: its home
  // conversation must stay that id so the file is never orphaned.
  const dir = path.join(session.rootPath, ".tangent", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "legacy-1.jsonl"),
    `${JSON.stringify({
      id: "m1",
      sessionId: session.id,
      conversationId: "legacy-1",
      author: { id: "legacy-1", kind: "agent", name: "Worker" },
      content: "hi",
      createdAt: "2026-01-01T00:00:00.000Z",
    })}\n`,
  );

  const recorded = await store.recordAgent(session.id, {
    id: "legacy-1",
    role: "subagent",
    name: "Worker",
    connector: connectorFor("pi-stdio"),
  });

  assert.equal(recorded.homeConversationId, "legacy-1");
});

test("the 0013 backfill claims pre-existing conversation rows for their agent", async () => {
  const db = openDb(":memory:");
  const store = new SqliteSessionStore(db);
  const session = await store.createSession({ name: "S" });

  // A pre-0013 counter row: keyed by an agent id, with no owner recorded yet.
  db.run(
    sql`INSERT INTO conversations (id, session_id, agent_id, next_seq, created_at)
        VALUES ('prime', ${session.id}, NULL, 1, '2026-01-01T00:00:00.000Z')`,
  );

  db.run(sql.raw(agentIdBackfillStatement()));

  const row = db.get(
    sql`SELECT agent_id FROM conversations WHERE id = 'prime' AND session_id = ${session.id}`,
  ) as { agent_id: string | null } | undefined;
  assert.equal(
    row?.agent_id,
    "prime",
    "a legacy row adopts its own id as its owner",
  );
});

test("recordAgent round-trips a connector descriptor", async () => {
  const store = newStore();
  const session = await store.createSession({ name: "S" });

  const recorded = await store.recordAgent(session.id, {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
    connector: {
      kind: "remote-env",
      lifecycle: "owned",
      spawnAuthority: "remote-env",
      credentialScheme: "shared-token",
      environmentId: "env-1",
    },
  });

  const expected = {
    kind: "remote-env",
    lifecycle: "owned",
    spawnAuthority: "remote-env",
    credentialScheme: "shared-token",
    environmentId: "env-1",
  };
  assert.deepEqual(recorded.connector, expected);
  const agents = await store.listAgents(session.id);
  assert.deepEqual(agents.find((a) => a.id === "sub-1")?.connector, expected);
});

test("an attached peer's endpoint round-trips, and nothing else carries one", async () => {
  const store = newStore();
  const session = await store.createSession({ name: "S" });

  await store.recordAgent(session.id, {
    id: "peer-1",
    role: "subagent",
    name: "Weather",
    connector: {
      kind: "a2a",
      lifecycle: "attached",
      spawnAuthority: "none",
      credentialScheme: "peer-bearer",
      endpointUrl: "https://agent.example.com",
    },
  });
  await store.recordAgent(session.id, {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
    connector: {
      kind: "pi-stdio",
      lifecycle: "owned",
      spawnAuthority: "server",
      credentialScheme: "inherited-token",
    },
  });

  const agents = await store.listAgents(session.id);
  assert.equal(
    agents.find((a) => a.id === "peer-1")?.connector.endpointUrl,
    "https://agent.example.com",
  );
  // Absent rather than empty: a participant that connects to Tangent has no far
  // end to dial, and the column says so by staying null.
  assert.equal(
    agents.find((a) => a.id === "sub-1")?.connector.endpointUrl,
    undefined,
  );
});

test("a row recorded without a connector defaults to pi-stdio", async () => {
  const store = newStore();
  const session = await store.createSession({ name: "S" });

  // A row written with no connector descriptor at all — the C.1 default fills
  // it in on read rather than deriving from a dropped `host` label.
  const recorded = await store.recordAgent(session.id, {
    id: "legacy",
    role: "subagent",
    name: "Old",
  });

  assert.deepEqual(recorded.connector, {
    kind: "pi-stdio",
    lifecycle: "owned",
    spawnAuthority: "server",
    credentialScheme: "inherited-token",
  });

  // Prime is recorded by `createSession` with no connector either.
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
    connector: {
      kind: "remote-env" as const,
      lifecycle: "owned" as const,
      spawnAuthority: "remote-env" as const,
      credentialScheme: "shared-token" as const,
      environmentId,
    },
  });
  await store.recordAgent(a.id, remote("mine-a", "env-1"));
  await store.recordAgent(b.id, remote("mine-b", "env-1"));
  await store.recordAgent(a.id, remote("theirs", "env-2"));
  // A remote row with no environment bound to it is not found by an env lookup.
  await store.recordAgent(a.id, {
    id: "legacy",
    role: "subagent",
    name: "legacy",
    connector: {
      kind: "remote-env",
      lifecycle: "owned",
      spawnAuthority: "remote-env",
      credentialScheme: "shared-token",
    },
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

test("recordAgent writes the agent's participant row, read back by listAgents", async () => {
  const db = openDb(":memory:");
  const participants = new SqliteParticipantStore(db);
  // No participant arg: `session_agents` is gone, so the store writes the
  // roster straight into the `participants` table the same DB backs.
  const store = new SqliteSessionStore(db);

  // createSession seeds Prime straight into the roster as an orchestrator.
  const session = await store.createSession({ name: "S" });
  const prime = await participants.get(session.id, "prime");
  assert.equal(prime?.kind, "agent");
  assert.deepEqual(prime?.capabilities, ["orchestrator", "supervisor"]);

  await store.recordAgent(session.id, {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
    connector: connectorFor("remote-env", "env-1"),
  });
  const sub = await participants.get(session.id, "sub-1");
  assert.deepEqual(sub?.capabilities, []);
  assert.equal(sub?.connector.environmentId, "env-1");

  // listAgents reads the same participant rows back as the roster.
  const roster = await store.listAgents(session.id);
  assert.deepEqual(roster.map((a) => a.id).sort(), ["prime", "sub-1"]);
});

test("setAgentStatus detaches the agent participant's status and presence", async () => {
  const db = openDb(":memory:");
  const participants = new SqliteParticipantStore(db);
  const store = new SqliteSessionStore(db);
  const session = await store.createSession({ name: "S" });
  await store.recordAgent(session.id, {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
  });

  await store.setAgentStatus(session.id, "sub-1", "detached");

  const detached = await participants.get(session.id, "sub-1");
  assert.equal(detached?.agent?.status, "detached");
  assert.equal(detached?.presence, "detached");
});

test("setAgentStatus to a non-detached status keeps the far end reachable", async () => {
  const db = openDb(":memory:");
  const participants = new SqliteParticipantStore(db);
  const store = new SqliteSessionStore(db);
  const session = await store.createSession({ name: "S" });
  await store.recordAgent(session.id, {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
  });

  // Matches the read-time mapping the roster projection used before C.2:
  // everything but a detached far end is `connected`.
  await store.setAgentStatus(session.id, "sub-1", "completed");

  const completed = await participants.get(session.id, "sub-1");
  assert.equal(completed?.agent?.status, "completed");
  assert.equal(completed?.presence, "connected");
});

test("detachActiveSubagents flips live sub-agents in the participant roster", async () => {
  const db = openDb(":memory:");
  const participants = new SqliteParticipantStore(db);
  const store = new SqliteSessionStore(db);
  const session = await store.createSession({ name: "S" });
  await store.recordAgent(session.id, {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
    status: "active",
  });

  assert.equal(await store.detachActiveSubagents(), 1);
  const sub = await participants.get(session.id, "sub-1");
  assert.equal(sub?.agent?.status, "detached");
  assert.equal(sub?.presence, "detached");
});

test("listAgents returns only agent participants, not humans", async () => {
  const db = openDb(":memory:");
  const participants = new SqliteParticipantStore(db);
  const store = new SqliteSessionStore(db);
  const session = await store.createSession({ name: "S" });
  await participants.put({
    id: "ada@example.com",
    sessionId: session.id,
    kind: "human",
    displayName: "Ada",
    capabilities: [],
    presence: "connected",
    connector: connectorFor("unresolved"),
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const roster = await store.listAgents(session.id);
  assert.deepEqual(
    roster.map((a) => a.id),
    ["prime"],
  );
});

test("pinning an artifact mirrors it into the resource catalog", async () => {
  const db = openDb(":memory:");
  const resources = new SqliteResourceStore(db);
  const store = new SqliteSessionStore(db, resources);
  const session = await store.createSession({ name: "S" });

  await store.pinArtifact(session.id, {
    path: "artifacts/report.html",
    title: "Report",
  });

  const catalogued = await resources.listForSession(session.id);
  assert.equal(catalogued.length, 1);
  assert.equal(catalogued[0].kind, "artifact");
  assert.equal(catalogued[0].uri, "artifacts/report.html");
  assert.equal(catalogued[0].name, "Report");

  // Re-pinning refreshes the title in place rather than duplicating.
  await store.pinArtifact(session.id, {
    path: "artifacts/report.html",
    title: "Report (final)",
  });
  const afterRepin = await resources.listForSession(session.id);
  assert.equal(afterRepin.length, 1);
  assert.equal(afterRepin[0].name, "Report (final)");

  // Unpinning removes the catalog entry too.
  await store.unpinArtifact(session.id, "artifacts/report.html");
  assert.equal((await resources.listForSession(session.id)).length, 0);
});
