import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";

import type { UiCommand } from "@tangent/shared/contracts";

const express = (await import("express")).default;
const { Router } = await import("express");
const { registerPinRoutes } = await import("./pins.ts");
const { handleArtifactPin, pinProblem } =
  await import("../../sockets/chatArtifacts.ts");
const { InMemorySessionStore } =
  await import("../../store/inMemorySessionStore.ts");
const { InMemoryParticipantStore } =
  await import("../../store/inMemoryParticipantStore.ts");
const { errorHandler } = await import("../../middleware/errorHandler.ts");

const closers: (() => void)[] = [];
after(() => {
  for (const close of closers) close();
});

async function serve() {
  const store = new InMemorySessionStore(new InMemoryParticipantStore());
  const session = await store.createSession({ name: "S" });
  const broadcasts: { sessionId: string; command: UiCommand }[] = [];

  const app = express();
  app.use(express.json());
  const router = Router();
  registerPinRoutes(router, store, (sessionId, command) =>
    broadcasts.push({ sessionId, command }),
  );
  app.use("/api/sessions", router);
  app.use(errorHandler);

  const server = app.listen(0);
  closers.push(() => server.close());
  const { port } = server.address() as AddressInfo;
  return {
    store,
    session,
    broadcasts,
    url: `http://127.0.0.1:${port}/api/sessions/${session.id}/pins`,
  };
}

test("POST /:id/pins pins a file and tells the session's room", async () => {
  const { store, session, broadcasts, url } = await serve();

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "artifacts/summary.html", title: "Summary" }),
  });

  assert.equal(res.status, 200);
  const pinned = await store.getArtifacts(session.id);
  assert.deepEqual(
    pinned.map(({ path, title }) => ({ path, title })),
    [{ path: "artifacts/summary.html", title: "Summary" }],
  );
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].command.kind, "artifacts.update");
});

test("DELETE /:id/pins unpins a file and tells the session's room", async () => {
  const { store, session, broadcasts, url } = await serve();
  await store.pinArtifact(session.id, {
    path: "artifacts/summary.html",
    title: "Summary",
  });

  const res = await fetch(
    `${url}?path=${encodeURIComponent("artifacts/summary.html")}`,
    { method: "DELETE" },
  );

  assert.equal(res.status, 204);
  assert.deepEqual(await store.getArtifacts(session.id), []);
  assert.equal(broadcasts.length, 1);
});

test("a pin needs a path", async () => {
  const { url } = await serve();

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "No path" }),
  });

  assert.equal(res.status, 400);
});

test("pinning in a session that doesn't exist is a 404", async () => {
  const { url } = await serve();

  const res = await fetch(url.replace(/sessions\/[^/]+/, "sessions/missing"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "artifacts/a.html" }),
  });

  assert.equal(res.status, 404);
});

const BAD_PATHS = [
  "https://example.com/x.html",
  "javascript:alert(1)",
  "mount://shared",
  "memory://session",
  "/etc/passwd",
  "artifacts/../../secrets.txt",
  "artifacts/%2e%2e/uploads/x.html",
  "../artifacts/a.html",
  "artifacts\\a.html",
  "artifacts/a\n.html",
  "artifacts",
  "artifacts/",
  "notes/a.html",
  `artifacts/${"a".repeat(1_100)}.html`,
];

test("only a relative path under artifacts/ or uploads/ can be pinned", () => {
  for (const path of BAD_PATHS) assert.ok(pinProblem({ path }), path);
  for (const path of [
    "artifacts/summary.html",
    "./artifacts/deep/er/summary.html",
    "uploads/data.csv",
    "artifacts/a..b.html",
  ]) {
    assert.equal(pinProblem({ path }), undefined, path);
  }
  assert.ok(pinProblem({ path: "artifacts/a.html", title: "t".repeat(301) }));
});

test("POST /:id/pins refuses a path that isn't one of the session's files", async () => {
  const { store, session, broadcasts, url } = await serve();

  for (const path of BAD_PATHS) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
    assert.equal(res.status, 400, path);
    const { error } = (await res.json()) as { error: string };
    assert.match(error, /artifacts\/ or uploads\/|at most/);
  }

  assert.deepEqual(await store.getArtifacts(session.id), []);
  assert.equal(broadcasts.length, 0);
});

test("the chat's pin toggle ignores a path that isn't one of the session's files", async () => {
  const { store, session, broadcasts } = await serve();
  const emit = (sessionId: string, command: UiCommand) =>
    broadcasts.push({ sessionId, command });

  for (const path of BAD_PATHS) {
    await handleArtifactPin(store, emit, {
      sessionId: session.id,
      path,
      title: "Bad",
    });
  }
  await handleArtifactPin(store, emit, {
    sessionId: session.id,
    path: "artifacts/a.html",
    title: "A",
  });

  assert.deepEqual(
    (await store.getArtifacts(session.id)).map(({ path }) => path),
    ["artifacts/a.html"],
  );
  assert.equal(broadcasts.length, 1);
});

test("a bad pin stored earlier can still be unpinned", async () => {
  const { store, session, url } = await serve();
  await store.pinArtifact(session.id, {
    path: "https://example.com/x.html",
    title: "Old",
  });

  const res = await fetch(
    `${url}?path=${encodeURIComponent("https://example.com/x.html")}`,
    { method: "DELETE" },
  );

  assert.equal(res.status, 204);
  assert.deepEqual(await store.getArtifacts(session.id), []);
});
