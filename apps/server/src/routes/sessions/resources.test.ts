import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir before importing modules that read
// config at load time, so `createSession`'s mkdir never touches the repo.
const ROOT = mkdtempSync(path.join(tmpdir(), "resources-rest-"));
process.env.SESSIONS_ROOT = ROOT;
process.env.GLOBAL_MEMORY_DIR = path.join(ROOT, "global-memory");

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
const { errorHandler } = await import("../../middleware/errorHandler.ts");
const { MAX_FILE_RESOURCE_BYTES, MAX_JSON_BODY_BYTES, UPLOADS_DIRNAME } =
  await import("../../config.ts");

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
  rmSync(ROOT, { recursive: true, force: true });
});

/** An unsigned JWT carrying just the email claim the identity resolver reads. */
function bearerFor(email: string): Record<string, string> {
  const payload = Buffer.from(JSON.stringify({ email })).toString("base64url");
  return { authorization: `Bearer header.${payload}.signature` };
}

/** A running express app mounting the resource route over a seeded catalog. */
async function serve(admins?: ReadonlySet<string>) {
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
  app.use(express.json({ limit: MAX_JSON_BODY_BYTES }));
  const router = Router();
  registerResourceRoutes(router, {
    store: sessions,
    resources: catalog,
    memory: new MemoryManager(),
    hostPreamble: new HostResourcePreamble(catalog),
    emitResourcesUpdated: () => {},
    admins,
  });
  app.use("/api/sessions", router);
  app.use(errorHandler);

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

  const post = async (
    pathname: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await fetch(`${base}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
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

  const del = async (
    pathname: string,
    headers: Record<string, string> = {},
  ) => {
    const res = await fetch(`${base}${pathname}`, {
      method: "DELETE",
      headers,
    });
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

const ADMINS: ReadonlySet<string> = new Set(["admin@example.com"]);
const GLOBAL_MEMORY = { kind: "memory", scope: "global", content: "Ship it." };
const GLOBAL_URI = `?uri=${encodeURIComponent("memory://global")}`;

test("global memory POST needs a signed-in admin when admins are configured", async () => {
  const { post, sessionId } = await serve(ADMINS);
  const route = `/${sessionId}/resources`;

  assert.equal((await post(route, GLOBAL_MEMORY)).status, 401);
  assert.equal(
    (await post(route, GLOBAL_MEMORY, bearerFor("someone@example.com"))).status,
    403,
  );
  assert.equal(
    (await post(route, GLOBAL_MEMORY, bearerFor("Admin@Example.com"))).status,
    201,
  );
});

test("global memory DELETE is admin-only when admins are configured", async () => {
  const { del, sessionId } = await serve(ADMINS);
  const route = `/${sessionId}/resources${GLOBAL_URI}`;

  assert.equal(
    (await del(route, bearerFor("someone@example.com"))).status,
    403,
  );
  assert.equal((await del(route, bearerFor("admin@example.com"))).status, 204);
});

test("session memory stays writable by non-admins when admins are configured", async () => {
  const { post, del, sessionId } = await serve(ADMINS);
  const outsider = bearerFor("someone@example.com");

  const created = await post(
    `/${sessionId}/resources`,
    { kind: "memory", scope: "session", content: "Prefer concise plans." },
    outsider,
  );
  assert.equal(created.status, 201);

  const removed = await del(
    `/${sessionId}/resources?uri=${encodeURIComponent("memory://session")}`,
    outsider,
  );
  assert.equal(removed.status, 204);
});

test("POST a file writes it under uploads/, catalogs it, and lists it", async () => {
  const { get, post, session, sessionId } = await serve();

  const created = await post(`/${sessionId}/resources`, {
    kind: "file",
    path: "config.yaml",
    content: "annotations: {}\n",
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.resource?.kind, "file");
  assert.equal(created.json.resource?.uri, "uploads/config.yaml");

  const onDisk = readFileSync(
    path.join(session.rootPath, UPLOADS_DIRNAME, "config.yaml"),
    "utf8",
  );
  assert.equal(onDisk, "annotations: {}\n");

  const listed = await get(`/${sessionId}/resources`);
  assert.equal(
    listed.json.resources.some((r) => r.uri === "uploads/config.yaml"),
    true,
  );
});

test("POST a file with a traversal path is rejected and writes nothing", async () => {
  const { post, session, sessionId } = await serve();

  const rejected = await post(`/${sessionId}/resources`, {
    kind: "file",
    path: "../../MEMORY.md",
    content: "pwned",
  });
  assert.equal(rejected.status, 400);
  assert.equal(existsSync(path.join(session.rootPath, "MEMORY.md")), false);
});

test("POST a file at path '.' is rejected and leaves uploads/ a directory", async () => {
  const { post, session, sessionId } = await serve();
  const uploads = path.join(session.rootPath, UPLOADS_DIRNAME);

  // Seed a real file first so uploads/ exists as a directory.
  await post(`/${sessionId}/resources`, {
    kind: "file",
    path: "seed.txt",
    content: "x",
  });

  const rejected = await post(`/${sessionId}/resources`, {
    kind: "file",
    path: ".",
    content: "would clobber uploads/",
  });
  assert.equal(rejected.status, 400);
  assert.equal(statSync(uploads).isDirectory(), true);
});

test("POST a file at the byte cap is accepted (the cap is now reachable)", async () => {
  const { post, sessionId } = await serve();

  const atLimit = await post(`/${sessionId}/resources`, {
    kind: "file",
    path: "big.bin",
    content: "a".repeat(MAX_FILE_RESOURCE_BYTES),
  });
  assert.equal(atLimit.status, 201);
});

test("POST a file over the byte cap is rejected by the schema", async () => {
  const { post, sessionId } = await serve();

  const overLimit = await post(`/${sessionId}/resources`, {
    kind: "file",
    path: "big.bin",
    content: "a".repeat(MAX_FILE_RESOURCE_BYTES + 1),
  });
  assert.equal(overLimit.status, 400);
});

test("POST a base64 file at the decoded byte cap is accepted", async () => {
  const { post, sessionId } = await serve();

  const atLimit = await post(`/${sessionId}/resources`, {
    kind: "file",
    path: "big.bin",
    encoding: "base64",
    content: Buffer.alloc(MAX_FILE_RESOURCE_BYTES).toString("base64"),
  });
  assert.equal(atLimit.status, 201);
});

test("POST a base64 file over the decoded byte cap is rejected", async () => {
  const { post, sessionId } = await serve();

  const overLimit = await post(`/${sessionId}/resources`, {
    kind: "file",
    path: "big.bin",
    encoding: "base64",
    content: Buffer.alloc(MAX_FILE_RESOURCE_BYTES + 1).toString("base64"),
  });
  assert.equal(overLimit.status, 400);
});

test("POST a file claiming base64 with a non-base64 string is rejected", async () => {
  const { post, session, sessionId } = await serve();

  const rejected = await post(`/${sessionId}/resources`, {
    kind: "file",
    path: "bad.bin",
    encoding: "base64",
    content: "not valid base64!!!",
  });
  assert.equal(rejected.status, 400);
  assert.equal(
    existsSync(path.join(session.rootPath, UPLOADS_DIRNAME, "bad.bin")),
    false,
  );
});

test("POST a base64 file writes the decoded bytes verbatim to disk", async () => {
  const { post, session, sessionId } = await serve();
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);

  const created = await post(`/${sessionId}/resources`, {
    kind: "file",
    path: "logo.png",
    encoding: "base64",
    content: bytes.toString("base64"),
  });
  assert.equal(created.status, 201);

  const written = readFileSync(
    path.join(session.rootPath, UPLOADS_DIRNAME, "logo.png"),
  );
  assert.deepEqual(written, bytes);
});

test("a request body over the JSON limit returns 413, not 500", async () => {
  const { post, sessionId } = await serve();

  const tooLarge = await post(`/${sessionId}/resources`, {
    kind: "file",
    path: "big.bin",
    content: "a".repeat(MAX_JSON_BODY_BYTES + 1024),
  });
  assert.equal(tooLarge.status, 413);
});

test("DELETE a file removes its bytes and the rescan does not resurrect it", async () => {
  const { get, post, del, session, sessionId } = await serve();
  await post(`/${sessionId}/resources`, {
    kind: "file",
    path: "gone.txt",
    content: "bye",
  });
  const onDisk = path.join(session.rootPath, UPLOADS_DIRNAME, "gone.txt");
  assert.equal(existsSync(onDisk), true);

  const removed = await del(
    `/${sessionId}/resources?uri=${encodeURIComponent("uploads/gone.txt")}`,
  );
  assert.equal(removed.status, 204);
  assert.equal(existsSync(onDisk), false);

  const listed = await get(`/${sessionId}/resources`);
  assert.equal(
    listed.json.resources.some((r) => r.uri === "uploads/gone.txt"),
    false,
  );
});
