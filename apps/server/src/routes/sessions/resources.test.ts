import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir before importing modules that read
// config at load time, so `createSession`'s mkdir never touches the repo.
const ROOT = mkdtempSync(path.join(tmpdir(), "resources-rest-"));
process.env.SESSIONS_ROOT = ROOT;

const express = (await import("express")).default;
const { Router } = await import("express");
const { registerResourceRoutes } = await import("./resources.ts");
const { ResourceCatalog } =
  await import("../../conversation/resourceCatalog.ts");
const { HostResourcePreamble } =
  await import("../../pi/hostResourcePreamble.ts");
const { MemoryManager } = await import("../../pi/memory.ts");
const { InMemoryResourceStore } =
  await import("../../store/inMemoryResourceStore.ts");
const { InMemorySessionStore } =
  await import("../../store/inMemorySessionStore.ts");
const { InMemoryParticipantStore } =
  await import("../../store/inMemoryParticipantStore.ts");

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
  rmSync(ROOT, { recursive: true, force: true });
});

/** A running express app mounting the resource route over a seeded catalog. */
async function serve() {
  const sessions = new InMemorySessionStore(new InMemoryParticipantStore());
  const catalog = new ResourceCatalog(new InMemoryResourceStore());
  const session = await sessions.createSession({ name: "S" });

  // Two artifacts referenced in the same Conversation.
  const a = await catalog.catalogIn("prime", {
    sessionId: session.id,
    kind: "artifact",
    name: "A",
    uri: "artifacts/a.html",
  });
  const b = await catalog.catalogIn("prime", {
    sessionId: session.id,
    kind: "artifact",
    name: "B",
    uri: "artifacts/b.html",
  });

  const app = express();
  app.use(express.json());
  const router = Router();
  registerResourceRoutes(router, {
    store: sessions,
    resources: catalog,
    memory: new MemoryManager(),
    hostPreamble: new HostResourcePreamble(catalog),
    emitResourcesUpdated: () => {},
  });
  app.use("/api/sessions", router);

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  cleanups.push(() => server.close());
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/sessions`;

  const get = async (pathname: string) => {
    const res = await fetch(`${base}${pathname}`);
    const text = await res.text();
    return {
      status: res.status,
      json: (text ? JSON.parse(text) : undefined) as {
        resources: { id: string; kind: string; uri: string }[];
      },
    };
  };

  const post = async (pathname: string, body: unknown) => {
    const res = await fetch(`${base}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return {
      status: res.status,
      json: (text ? JSON.parse(text) : undefined) as {
        resource?: { id: string; kind: string; uri: string; name: string };
      },
    };
  };

  const del = async (pathname: string) => {
    const res = await fetch(`${base}${pathname}`, { method: "DELETE" });
    return { status: res.status };
  };

  return { get, post, del, catalog, session, sessionId: session.id, a, b };
}

test("GET resources returns the whole session catalog unscoped", async () => {
  const { get, sessionId, a, b } = await serve();
  const { status, json } = await get(`/${sessionId}/resources`);
  assert.equal(status, 200);
  assert.deepEqual(json.resources.map((r) => r.id).sort(), [a.id, b.id].sort());
});

test("GET resources scoped to a participant consults surfacedFor", async () => {
  const { get, catalog, sessionId, a, b } = await serve();

  // Default-permissive with no grants: the scoped view is the full reference set.
  const before = await get(
    `/${sessionId}/resources?conversationId=prime&participantId=ben`,
  );
  assert.deepEqual(
    before.json.resources.map((r) => r.id).sort(),
    [a.id, b.id].sort(),
  );

  // A grant narrows ben's surfaced view to the granted subset only.
  await catalog.grant({
    sessionId,
    conversationId: "prime",
    participantId: "ben",
    resourceId: a.id,
  });
  const after = await get(
    `/${sessionId}/resources?conversationId=prime&participantId=ben`,
  );
  assert.deepEqual(
    after.json.resources.map((r) => r.id),
    [a.id],
  );

  // A different participant with no grants still sees everything.
  const other = await get(
    `/${sessionId}/resources?conversationId=prime&participantId=ana`,
  );
  assert.equal(other.json.resources.length, 2);
});

test("POST a host resource catalogs it and it appears in GET", async () => {
  const { get, post, sessionId } = await serve();

  const created = await post(`/${sessionId}/resources`, {
    kind: "host",
    name: "Orders pipeline",
    uri: "https://tangent.example/pipelines/orders",
    meta: { description: "Ingests orders." },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.resource?.kind, "host");
  assert.equal(created.json.resource?.name, "Orders pipeline");

  const listed = await get(`/${sessionId}/resources`);
  const host = listed.json.resources.find((r) => r.kind === "host");
  assert.equal(host?.uri, "https://tangent.example/pipelines/orders");
});

test("POST a memory resource writes MEMORY.md and catalogs it", async () => {
  const { post, session, sessionId } = await serve();

  const created = await post(`/${sessionId}/resources`, {
    kind: "memory",
    scope: "session",
    content: "Prefer concise plans.",
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.resource?.uri, "memory://session");

  const file = readFileSync(path.join(session.rootPath, "MEMORY.md"), "utf8");
  assert.match(file, /Prefer concise plans\./);
});

test("POST rejects a non-host-writable kind", async () => {
  const { post, sessionId } = await serve();
  const rejected = await post(`/${sessionId}/resources`, {
    kind: "artifact",
    name: "A",
    uri: "artifacts/a.html",
  });
  assert.equal(rejected.status, 400);
});

test("DELETE drops a host row", async () => {
  const { get, post, del, sessionId } = await serve();
  const uri = "https://tangent.example/pipelines/orders";
  await post(`/${sessionId}/resources`, { kind: "host", name: "Orders", uri });

  const removed = await del(
    `/${sessionId}/resources?uri=${encodeURIComponent(uri)}`,
  );
  assert.equal(removed.status, 204);

  const listed = await get(`/${sessionId}/resources`);
  assert.equal(
    listed.json.resources.some((r) => r.uri === uri),
    false,
  );
});

test("DELETE a memory resource clears the store", async () => {
  const { post, del, session, sessionId } = await serve();
  await post(`/${sessionId}/resources`, {
    kind: "memory",
    scope: "session",
    content: "remember-me-secret",
  });

  const removed = await del(
    `/${sessionId}/resources?uri=${encodeURIComponent("memory://session")}`,
  );
  assert.equal(removed.status, 204);

  const file = readFileSync(path.join(session.rootPath, "MEMORY.md"), "utf8");
  assert.doesNotMatch(file, /remember-me-secret/);
});
