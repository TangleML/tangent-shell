import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir before importing modules that read
// config at load time, so `createSession`'s mkdir never touches the repo.
const ROOT = mkdtempSync(path.join(tmpdir(), "participant-store-"));
process.env.SESSIONS_ROOT = ROOT;

const { connectorFor } = await import("@tangent/shared/contracts.ts");
const { openDb } = await import("./db/client.ts");
const { SqliteParticipantStore } = await import("./sqliteParticipantStore.ts");
const { SqliteSessionStore } = await import("./sqliteSessionStore.ts");

type Participant = import("./participantStore.ts").Participant;

after(() => rmSync(ROOT, { recursive: true, force: true }));

/** A migrated in-memory DB with one real session for the FK to point at. */
async function withSession() {
  const db = openDb(":memory:");
  const session = await new SqliteSessionStore(db).createSession({ name: "S" });
  return { store: new SqliteParticipantStore(db), sessionId: session.id };
}

function participant(
  sessionId: string,
  overrides: Partial<Participant> = {},
): Participant {
  return {
    id: "p-1",
    sessionId,
    kind: "agent",
    displayName: "Worker",
    capabilities: [],
    presence: "connected",
    connector: connectorFor("pi-stdio"),
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("put then get round-trips capabilities, connector, and agent payload", async () => {
  const { store, sessionId } = await withSession();
  const row = participant(sessionId, {
    id: "prime",
    displayName: "Prime",
    capabilities: ["orchestrator"],
    connector: connectorFor("remote-env", "env-1"),
    agent: { role: "prime", host: "remote", status: "active", tools: ["a"] },
  });

  await store.put(row);
  const got = await store.get(sessionId, "prime");
  assert.ok(got);
  assert.ok(got.agent);

  assert.deepEqual(got.capabilities, ["orchestrator"]);
  assert.equal(got.connector.kind, "remote-env");
  assert.equal(got.connector.environmentId, "env-1");
  assert.equal(got.agent.role, "prime");
  assert.deepEqual(got.agent.tools, ["a"]);
});

test("put upserts by (session, id) rather than duplicating", async () => {
  const { store, sessionId } = await withSession();
  await store.put(participant(sessionId, { displayName: "First" }));
  await store.put(participant(sessionId, { displayName: "Second" }));

  const all = await store.listForSession(sessionId);
  assert.equal(all.length, 1);
  assert.equal(all[0].displayName, "Second");
});

test("listForSession returns a session's rows oldest first", async () => {
  const { store, sessionId } = await withSession();
  await store.put(
    participant(sessionId, { id: "b", createdAt: "2026-01-02T00:00:00.000Z" }),
  );
  await store.put(
    participant(sessionId, { id: "a", createdAt: "2026-01-01T00:00:00.000Z" }),
  );

  const ids = (await store.listForSession(sessionId)).map((p) => p.id);
  assert.deepEqual(ids, ["a", "b"]);
});

test("get returns nothing for a participant that was never written", async () => {
  const { store, sessionId } = await withSession();
  assert.equal(await store.get(sessionId, "missing"), undefined);
});
