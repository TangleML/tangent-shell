import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir before importing modules that read
// config at load time.
const ROOT = mkdtempSync(path.join(tmpdir(), "bundle-editors-rest-"));
process.env.SESSIONS_ROOT = ROOT;

const express = (await import("express")).default;
const { createBundleEditorsRouter } = await import("./bundleEditors.ts");
const { openDb } = await import("../store/db/client.ts");
const { SqliteBundleEditorStore } =
  await import("../store/sqliteBundleEditorStore.ts");

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
  rmSync(ROOT, { recursive: true, force: true });
});

const ADMIN = "admin@example.com";

function bearerFor(email: string): Record<string, string> {
  const payload = Buffer.from(JSON.stringify({ email })).toString("base64url");
  return { authorization: `Bearer header.${payload}.signature` };
}

async function serve() {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/bundle-editors",
    createBundleEditorsRouter(
      new SqliteBundleEditorStore(openDb(":memory:")),
      new Set([ADMIN]),
    ),
  );
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  cleanups.push(() => server.close());
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/bundle-editors`;

  return (pathname: string, init: RequestInit = {}, as = ADMIN) =>
    fetch(`${base}${pathname}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...bearerFor(as),
        ...init.headers,
      },
    });
}

test("non-admins can't read or change the editor list", async () => {
  const call = await serve();
  const outsider = "someone@example.com";

  assert.equal((await call("/", {}, outsider)).status, 403);
  const add = await call(
    "/",
    { method: "POST", body: JSON.stringify({ email: outsider }) },
    outsider,
  );
  assert.equal(add.status, 403);
});

test("an admin adds, lists, and removes a normalized editor", async () => {
  const call = await serve();

  const added = await call("/", {
    method: "POST",
    body: JSON.stringify({ email: "  Editor@Example.com " }),
  });
  assert.equal(added.status, 201);
  const { editor } = (await added.json()) as {
    editor: { email: string; addedBy: string };
  };
  assert.deepEqual(
    { email: editor.email, addedBy: editor.addedBy },
    { email: "editor@example.com", addedBy: ADMIN },
  );

  const listed = (await (await call("/")).json()) as {
    editors: { email: string }[];
    admins: string[];
  };
  assert.deepEqual(
    listed.editors.map((e) => e.email),
    ["editor@example.com"],
  );
  assert.deepEqual(listed.admins, [ADMIN]);

  const removed = await call(`/${encodeURIComponent("Editor@Example.com")}`, {
    method: "DELETE",
  });
  assert.equal(removed.status, 204);
  const missing = await call(`/${encodeURIComponent("editor@example.com")}`, {
    method: "DELETE",
  });
  assert.equal(missing.status, 404);
});

test("an invalid email is rejected", async () => {
  const call = await serve();
  const res = await call("/", {
    method: "POST",
    body: JSON.stringify({ email: "not-an-email" }),
  });
  assert.equal(res.status, 400);
});
