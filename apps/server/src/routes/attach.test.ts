import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir before importing modules that read
// config at load time.
const ROOT = mkdtempSync(path.join(tmpdir(), "attach-rest-"));
process.env.SESSIONS_ROOT = ROOT;

const express = (await import("express")).default;
const { createAttachRouter } = await import("./attach.ts");
const { ScopedTokenCredential } = await import("../connectors/credentials.ts");
const { ExternalSubagentGateway } =
  await import("../external/externalSubagentGateway.ts");
const { RelayRegistry } = await import("../mcp/relayRegistry.ts");
const { RunRegistry } = await import("../runs/runRegistry.ts");
const { InMemoryRunStore } = await import("../store/inMemoryRunStore.ts");
const { InMemorySessionStore } =
  await import("../store/inMemorySessionStore.ts");
const { InMemoryParticipantStore } =
  await import("../store/inMemoryParticipantStore.ts");
const { InMemoryResourceStore } =
  await import("../store/inMemoryResourceStore.ts");
const { InMemorySharedFolderStore } =
  await import("../store/inMemorySharedFolderStore.ts");
const { ResourceCatalog } = await import("../conversation/resourceCatalog.ts");
const { HostResourcePreamble } = await import("../pi/hostResourcePreamble.ts");
const { MemoryManager } = await import("../pi/memory.ts");
const { errorHandler } = await import("../middleware/errorHandler.ts");

import { ATTACH_TOKEN_HEADER } from "@tangent/shared/contracts.ts";

import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import type { ConversationRouter } from "../conversation/conversationRouter.ts";
import type { ConversationEventSink } from "../pi/types.ts";

const SECRET = "attach-test-secret";

/** The resource-route deps an attach server runs with, over in-memory stores. */
function attachResources(store: InstanceType<typeof InMemorySessionStore>) {
  const catalog = new ResourceCatalog(new InMemoryResourceStore());
  const resources = {
    seed: {
      store,
      memory: new MemoryManager(),
      catalog,
      sharedFolders: new InMemorySharedFolderStore(),
    },
    catalog,
    hostPreamble: new HostResourcePreamble(catalog),
    emitResourcesUpdated: () => {},
  };
  return { catalog, resources };
}

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
  rmSync(ROOT, { recursive: true, force: true });
});

/** A running attach API over a fresh gateway, with a token signer to match. */
async function serve() {
  const sink: ConversationEventSink = {
    onAgentEvent: () => {},
    onSubagentUpdate: () => {},
    onAgentMessage: () => {},
    onSessionStatus: () => {},
  };
  const runs = new RunRegistry(new InMemoryRunStore());
  const store = new InMemorySessionStore(new InMemoryParticipantStore());
  const gateway = new ExternalSubagentGateway(
    sink,
    runs,
    store,
    new RelayRegistry(),
  );
  const scoped = new ScopedTokenCredential(SECRET);

  // The attach announce reads the roster through the connector registry; an
  // empty one makes it a no-op, which is all these auth-focused tests need.
  const connectors = { list: () => [] } as unknown as ConnectorRegistry;
  const conversations = {
    post: async () => {},
  } as unknown as ConversationRouter;

  const { catalog, resources } = attachResources(store);

  const app = express();
  app.use(express.json());
  app.use(
    "/api/attach",
    createAttachRouter(
      gateway,
      store,
      connectors,
      conversations,
      resources,
      scoped,
    ),
  );
  app.use(errorHandler);

  const server = app.listen(0);
  cleanups.push(() => server.close());
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/attach`;

  const sessionToken = (sessionId: string) =>
    scoped.mint({ environmentId: "env-1", sessionId, sub: "user@example.com" })
      .token;
  const userToken = () =>
    scoped.mint({ environmentId: "env-1", sub: "user@example.com" }).token;

  return { base, gateway, store, catalog, sessionToken, userToken };
}

/**
 * POSTs a JSON body to an attach route with an optional token. The token rides
 * on `Authorization: Bearer` by default, or on {@link ATTACH_TOKEN_HEADER} when
 * `viaFallbackHeader` is set — the carrier used when an SSO proxy strips
 * `Authorization`.
 */
async function postJson(
  base: string,
  route: string,
  body: unknown,
  token?: string,
  viaFallbackHeader = false,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token && viaFallbackHeader) headers[ATTACH_TOKEN_HEADER] = token;
  else if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${route}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

test("register without a token is a 401", async () => {
  const { base } = await serve();
  const res = await postJson(base, "/register", {
    sessionId: "s1",
    name: "worker",
  });
  assert.equal(res.status, 401);
});

test("register with a garbage bearer is a 401", async () => {
  const { base } = await serve();
  const res = await postJson(
    base,
    "/register",
    { sessionId: "s1", name: "worker" },
    "re1.not.valid",
  );
  assert.equal(res.status, 401);
});

test("a user-scoped token cannot attach — a session must be named", async () => {
  const { base, userToken } = await serve();
  const res = await postJson(
    base,
    "/register",
    { sessionId: "s1", name: "worker" },
    userToken(),
  );
  assert.equal(res.status, 403);
});

test("a token for one session cannot drive another's register", async () => {
  const { base, sessionToken } = await serve();
  const res = await postJson(
    base,
    "/register",
    { sessionId: "s2", name: "worker" },
    sessionToken("s1"),
  );
  assert.equal(res.status, 403);
});

test("a session-scoped token registers a tab on its own session", async () => {
  const { base, gateway, sessionToken } = await serve();
  const res = await postJson(
    base,
    "/register",
    { sessionId: "s1", name: "worker" },
    sessionToken("s1"),
  );

  assert.equal(res.status, 200);
  const body = (await res.json()) as { subagent: { id: string } };
  assert.ok(body.subagent.id);
  assert.equal(gateway.hasAgent("s1", body.subagent.id), true);
});

test("a session-scoped token on the fallback header registers without Authorization", async () => {
  const { base, gateway, sessionToken } = await serve();
  const res = await postJson(
    base,
    "/register",
    { sessionId: "s1", name: "worker" },
    sessionToken("s1"),
    true,
  );

  assert.equal(res.status, 200);
  const body = (await res.json()) as { subagent: { id: string } };
  assert.ok(body.subagent.id);
  assert.equal(gateway.hasAgent("s1", body.subagent.id), true);
});

test("every attach route is pinned to the token's session", async () => {
  const { base, sessionToken } = await serve();
  const token = sessionToken("s1");

  // A body valid for each route's schema, but naming a session the token does
  // not hold — so a 403 proves the session check, not a 400 validation miss.
  const foreign: Record<string, Record<string, unknown>> = {
    "/deliveries": { sessionId: "s2" },
    "/run": { sessionId: "s2", agentId: "a1" },
    "/run/end": { sessionId: "s2", agentId: "a1", status: "completed" },
    "/event": { sessionId: "s2", agentId: "a1", event: { type: "start" } },
    "/status": { sessionId: "s2", agentId: "a1", status: "active" },
    "/report": { sessionId: "s2", agentId: "a1", text: "blocked" },
    "/resources/list": { sessionId: "s2" },
    "/resources/read": { sessionId: "s2", uri: "uploads/x.txt" },
    "/resources/put": {
      sessionId: "s2",
      agentId: "a1",
      input: { kind: "memory", content: "x" },
    },
  };

  for (const [route, body] of Object.entries(foreign)) {
    const res = await postJson(base, route, body, token);
    assert.equal(res.status, 403, `${route} must reject a foreign session`);
  }
});

test("a session-scoped token puts, lists, and reads a file resource", async () => {
  const { base, store, sessionToken } = await serve();
  const session = await store.createSession({ name: "S" });
  const token = sessionToken(session.id);

  const put = await postJson(
    base,
    "/resources/put",
    {
      sessionId: session.id,
      agentId: "a1",
      input: { kind: "file", path: "report.csv", content: "a,b\n1,2\n" },
    },
    token,
  );
  assert.equal(put.status, 201);
  const putBody = (await put.json()) as { resource: { uri: string } };
  assert.equal(putBody.resource.uri, "uploads/report.csv");

  const list = await postJson(
    base,
    "/resources/list",
    { sessionId: session.id },
    token,
  );
  assert.equal(list.status, 200);
  const listBody = (await list.json()) as {
    resources: { uri: string }[];
  };
  assert.ok(listBody.resources.some((r) => r.uri === "uploads/report.csv"));

  const read = await postJson(
    base,
    "/resources/read",
    { sessionId: session.id, uri: "uploads/report.csv" },
    token,
  );
  assert.equal(read.status, 200);
  const readBody = (await read.json()) as {
    content: string;
    contentType: string;
  };
  assert.equal(
    Buffer.from(readBody.content, "base64").toString("utf8"),
    "a,b\n1,2\n",
  );
  assert.equal(readBody.contentType, "text/csv");
});

test("a session-scoped token may post a report to its own session", async () => {
  const { base, store, sessionToken } = await serve();
  const session = await store.createSession({ name: "S" });

  const res = await postJson(
    base,
    "/report",
    { sessionId: session.id, agentId: "a1", text: "blocked on credentials" },
    sessionToken(session.id),
  );
  assert.equal(res.status, 200);
});

test("a deliveries poll scoped to an agent returns only that agent's work", async () => {
  const { base, gateway, sessionToken } = await serve();
  const a = await gateway.register("s1", { name: "a" });
  const b = await gateway.register("s1", { name: "b" });
  gateway.deliver("s1", a.id, "for a");
  gateway.deliver("s1", b.id, "for b");

  const res = await postJson(
    base,
    "/deliveries",
    { sessionId: "s1", agentId: b.id },
    sessionToken("s1"),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    deliveries: { agentId: string; text: string }[];
  };
  assert.deepEqual(body.deliveries, [{ agentId: b.id, text: "for b" }]);
});

test("a killed agent's directive is never delivered to a fresh agent in the session", async () => {
  const { base, gateway, sessionToken } = await serve();
  const old = await gateway.register("s1", { name: "old" });
  gateway.deliver("s1", old.id, "old work");
  gateway.setStatus("s1", old.id, "killed");
  const fresh = await gateway.register("s1", { name: "fresh" });
  gateway.deliver("s1", fresh.id, "fresh work");

  const res = await postJson(
    base,
    "/deliveries",
    { sessionId: "s1", agentId: fresh.id },
    sessionToken("s1"),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    deliveries: { agentId: string; text: string }[];
  };
  assert.deepEqual(body.deliveries, [
    { agentId: fresh.id, text: "fresh work" },
  ]);
});

test("a resource read outside the session's folders is rejected", async () => {
  const { base, store, sessionToken } = await serve();
  const session = await store.createSession({ name: "S" });

  const res = await postJson(
    base,
    "/resources/read",
    { sessionId: session.id, uri: "../../etc/passwd" },
    sessionToken(session.id),
  );
  assert.equal(res.status, 400);
});

test("a file resource path that escapes uploads is rejected", async () => {
  const { base, store, sessionToken } = await serve();
  const session = await store.createSession({ name: "S" });

  const res = await postJson(
    base,
    "/resources/put",
    {
      sessionId: session.id,
      agentId: "a1",
      input: { kind: "file", path: "../escape.txt", content: "x" },
    },
    sessionToken(session.id),
  );
  assert.equal(res.status, 400);
});
