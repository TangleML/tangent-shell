import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";

// The internal routes check this token, which config reads at load time.
process.env.TANGENT_INTERNAL_TOKEN = "test-internal-token";

const express = (await import("express")).default;
const { createInternalSessionRouter, isPlaceholderSessionName } =
  await import("./internalSession.ts");
const { InMemorySessionStore } =
  await import("../store/inMemorySessionStore.ts");
const { InMemoryParticipantStore } =
  await import("../store/inMemoryParticipantStore.ts");
const { connectorFor } = await import("@tangent/shared/contracts.ts");

const closers: (() => void)[] = [];
after(() => {
  for (const close of closers) close();
});

async function serve() {
  const store = new InMemorySessionStore(new InMemoryParticipantStore());
  const session = await store.createSession({ name: "S" });
  const dismissed: { sessionId: string; agentId: string }[] = [];

  const app = express();
  app.use(express.json());
  app.use(
    "/internal/session",
    createInternalSessionRouter(
      store,
      () => undefined,
      (sessionId, agentId) => dismissed.push({ sessionId, agentId }),
    ),
  );
  const server = app.listen(0);
  closers.push(() => server.close());
  const { port } = server.address() as AddressInfo;

  async function dismiss(agentId: string) {
    return fetch(`http://127.0.0.1:${port}/internal/session/dismiss-subagent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-internal-token",
      },
      body: JSON.stringify({ sessionId: session.id, agentId }),
    });
  }

  async function rename(
    sessionId: string,
    name: string,
    onlyIfUnnamed?: boolean,
  ) {
    return fetch(`http://127.0.0.1:${port}/internal/session/rename`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-internal-token",
      },
      body: JSON.stringify({ sessionId, name, onlyIfUnnamed }),
    });
  }

  return { store, session, dismissed, dismiss, rename };
}

async function recordSubagent(
  store: InstanceType<typeof InMemorySessionStore>,
  sessionId: string,
  id: string,
  status: "active" | "completed",
) {
  await store.recordAgent(sessionId, {
    id,
    role: "subagent",
    name: id,
    status,
    connector: connectorFor("pi-stdio"),
  });
}

test("dismiss-subagent drops a finished sub-agent and tells the room", async () => {
  const { store, session, dismissed, dismiss } = await serve();
  await recordSubagent(store, session.id, "sub-done", "completed");

  const res = await dismiss("sub-done");

  assert.equal(res.status, 200);
  assert.deepEqual(dismissed, [{ sessionId: session.id, agentId: "sub-done" }]);
  const agents = await store.listAgents(session.id);
  assert.ok(agents.find(({ id }) => id === "sub-done")?.dismissedAt);
});

test("dismiss-subagent refuses a sub-agent that is still running", async () => {
  const { store, session, dismissed, dismiss } = await serve();
  await recordSubagent(store, session.id, "sub-busy", "active");

  const res = await dismiss("sub-busy");

  assert.equal(res.status, 409);
  assert.deepEqual(dismissed, []);
});

test("dismiss-subagent says when there is no such sub-agent", async () => {
  const { dismissed, dismiss } = await serve();

  const res = await dismiss("nobody");

  assert.equal(res.status, 404);
  assert.deepEqual(dismissed, []);
});

test("dismiss-subagent treats an already dismissed sub-agent as gone", async () => {
  const { store, session, dismissed, dismiss } = await serve();
  await recordSubagent(store, session.id, "sub-done", "completed");
  await dismiss("sub-done");

  const res = await dismiss("sub-done");

  assert.equal(res.status, 404);
  assert.equal(dismissed.length, 1, "the room is told only once");
});

test("placeholder session names are told apart from chosen ones", () => {
  for (const name of [
    "Session 3",
    "session",
    "New Tangent session",
    "New session",
    "Untitled",
    "",
  ]) {
    assert.equal(isPlaceholderSessionName(name), true, name);
  }
  for (const name of ["Churn model training", "Session notes for Q3"]) {
    assert.equal(isPlaceholderSessionName(name), false, name);
  }
});

test("rename with onlyIfUnnamed titles a session that has a placeholder name", async () => {
  const { store, rename } = await serve();
  const fresh = await store.createSession({ name: "New Tangent session" });

  const res = await rename(fresh.id, "Churn model training", true);

  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    renamed: boolean;
    session: { name: string };
  };
  assert.equal(body.renamed, true);
  assert.equal(body.session.name, "Churn model training");
  assert.equal(
    (await store.getSession(fresh.id))?.name,
    "Churn model training",
  );
});

test("rename with onlyIfUnnamed keeps a name someone chose", async () => {
  const { store, rename } = await serve();
  const named = await store.createSession({ name: "Ranking ablations" });

  const res = await rename(named.id, "Something else", true);

  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    renamed: boolean;
    session: { name: string };
  };
  assert.equal(body.renamed, false);
  assert.equal((await store.getSession(named.id))?.name, "Ranking ablations");
});

test("an explicit rename still replaces a chosen name", async () => {
  const { store, rename } = await serve();
  const named = await store.createSession({ name: "Ranking ablations" });

  const res = await rename(named.id, "Ranking ablations v2");

  assert.equal(res.status, 200);
  assert.equal(
    (await store.getSession(named.id))?.name,
    "Ranking ablations v2",
  );
});
