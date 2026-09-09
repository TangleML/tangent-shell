import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
  registerResourceRoutes(router, sessions, catalog);
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
        resources: { id: string }[];
      },
    };
  };

  return { get, catalog, sessionId: session.id, a, b };
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
