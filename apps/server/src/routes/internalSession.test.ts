import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { UiCommand } from "@tangent/shared/contracts.ts";

// Point the session root at a throwaway dir before importing modules that read
// config at load time, so `createSession`'s mkdir never touches the repo.
const ROOT = mkdtempSync(path.join(tmpdir(), "internal-session-"));
process.env.SESSIONS_ROOT = ROOT;

const express = (await import("express")).default;
const { INTERNAL_TOKEN, MAX_JSON_BODY_BYTES } = await import("../config.ts");
const { openDb } = await import("../store/db/client.ts");
const { SqliteResourceStore } = await import("../store/sqliteResourceStore.ts");
const { SqliteSessionStore } = await import("../store/sqliteSessionStore.ts");
const { createInternalSessionRouter } = await import("./internalSession.ts");

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
  rmSync(ROOT, { recursive: true, force: true });
});

/** The internal session router over a real SQLite store, plus what it broadcast. */
async function serve() {
  const db = openDb(":memory:");
  const resources = new SqliteResourceStore(db);
  const store = new SqliteSessionStore(db, resources);
  const session = await store.createSession({ name: "S" });
  const commands: UiCommand[] = [];

  const app = express();
  app.use(express.json({ limit: MAX_JSON_BODY_BYTES }));
  app.use(
    "/internal/session",
    createInternalSessionRouter(store, (_sessionId, command) => {
      commands.push(command);
    }),
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  cleanups.push(() => server.close());
  const { port } = server.address() as AddressInfo;

  const post = async (endpoint: string, body: Record<string, unknown>) => {
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/session/${endpoint}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${INTERNAL_TOKEN}`,
        },
        body: JSON.stringify({ sessionId: session.id, ...body }),
      },
    );
    return { status: res.status, json: (await res.json()) as unknown };
  };

  return { store, resources, session, commands, post };
}

test("pin-link stores a canonical link pin once and mirrors it as a link resource", async () => {
  const { store, resources, session, commands, post } = await serve();

  const first = await post("pin-link", {
    url: "  HTTPS://Delta.Shopify.io/shop/world/pull/2395291  ",
    title: "PR 2395291",
  });
  assert.equal(first.status, 200);
  await post("pin-link", {
    url: "https://delta.shopify.io/shop/world/pull/2395291",
    title: "World PR",
  });

  const pins = await store.getArtifacts(session.id);
  assert.equal(pins.length, 1, "the same URL dedupes");
  const [pin] = pins;
  assert.ok(pin.kind === "link");
  assert.equal(pin.url, "https://delta.shopify.io/shop/world/pull/2395291");
  assert.equal(pin.title, "World PR", "re-pinning refreshes the title");
  assert.deepEqual(
    commands.map((command) => command.kind),
    ["artifacts.update", "artifacts.update"],
  );

  const catalogued = await resources.listForSession(session.id);
  assert.deepEqual(
    catalogued.map((r) => [r.kind, r.uri, r.name]),
    [["link", "https://delta.shopify.io/shop/world/pull/2395291", "World PR"]],
  );
});

test("pin-link defaults the title to the URL's host", async () => {
  const { store, session, post } = await serve();

  await post("pin-link", { url: "https://grafana.example.com/d/abc?x=1" });

  const [pin] = await store.getArtifacts(session.id);
  assert.equal(pin.title, "grafana.example.com");
});

for (const url of [
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "file:///etc/passwd",
  "ftp://example.com/file",
  "artifacts/report.html",
  "//example.com/no-scheme",
  "https://user:secret@example.com/",
  "https://token@example.com/",
  `https://example.com/${"a".repeat(2048)}`,
  "",
]) {
  test(`pin-link rejects ${JSON.stringify(url.slice(0, 40))}`, async () => {
    const { store, session, commands, post } = await serve();

    const res = await post("pin-link", { url, title: "Bad" });

    assert.equal(res.status, 400);
    assert.deepEqual(await store.getArtifacts(session.id), []);
    assert.equal(commands.length, 0);
  });
}

test("unpin-link removes only the link; artifact pins keep their shape", async () => {
  const { store, resources, session, post } = await serve();

  await post("pin-artifact", {
    path: "artifacts/report.html",
    title: "Report",
  });
  await post("pin-link", { url: "https://example.com/doc", title: "Doc" });

  const both = await store.getArtifacts(session.id);
  assert.deepEqual(
    both.map((pin) => [
      pin.kind,
      pin.kind === "link" ? pin.url : pin.path,
      pin.title,
    ]),
    [
      ["artifact", "artifacts/report.html", "Report"],
      ["link", "https://example.com/doc", "Doc"],
    ],
  );

  // Unpinning matches the canonical form, and an artifact path is not a link.
  const unpinned = await post("unpin-link", { url: "HTTPS://EXAMPLE.COM/doc" });
  assert.equal(unpinned.status, 200);
  await store.unpinLink(session.id, "artifacts/report.html");

  const remaining = await store.getArtifacts(session.id);
  assert.deepEqual(
    remaining.map((pin) => pin.kind),
    ["artifact"],
  );
  assert.deepEqual(
    (await resources.listForSession(session.id)).map((r) => r.kind),
    ["artifact"],
  );
});

test("pin-artifact rejects a URL path and points to pin_link", async () => {
  const { store, session, post } = await serve();

  const res = await post("pin-artifact", {
    path: "https://example.com/pr/1",
    title: "PR",
  });

  assert.equal(res.status, 400);
  assert.match(JSON.stringify(res.json), /pin_link/);
  assert.deepEqual(await store.getArtifacts(session.id), []);
});

test("unpin-artifact still removes a legacy artifact pin whose path is a URL", async () => {
  const { store, session, post } = await serve();
  await store.pinArtifact(session.id, {
    path: "https://example.com/pr/1",
    title: "PR",
  });

  const res = await post("unpin-artifact", {
    path: "https://example.com/pr/1",
  });

  assert.equal(res.status, 200);
  assert.deepEqual(await store.getArtifacts(session.id), []);
});

test("a link pin neither relabels nor deletes a host resource at the same URL", async () => {
  const { resources, session, post } = await serve();
  const uri = "https://example.com/orders";
  await resources.catalog({
    sessionId: session.id,
    kind: "host",
    name: "Orders",
    uri,
  });

  await post("pin-link", { url: uri, title: "Orders dashboard" });
  await post("unpin-link", { url: uri });

  assert.deepEqual(
    (await resources.listForSession(session.id)).map((r) => [r.kind, r.name]),
    [["host", "Orders"]],
  );
});
