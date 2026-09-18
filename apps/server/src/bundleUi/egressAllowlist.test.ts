import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { TANGLE_API_URL } from "../config.ts";
import {
  EgressDeniedError,
  resolveEgress,
  resolveTargetUrl,
} from "./egressAllowlist.ts";

afterEach(() => {
  delete process.env.TANGLE_TOKEN;
  mock.reset();
});

test("resolves a logical Tangle target and injects server-side credentials", async () => {
  process.env.TANGLE_TOKEN = "SESSION=abc";
  const expectedBase = new URL(TANGLE_API_URL);
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.origin, expectedBase.origin);
      assert.equal(url.pathname, "/api/executions/run-1/state");
      assert.equal(url.searchParams.get("include"), "true");
      assert.equal(
        (init?.headers as Record<string, string> | undefined)?.cookie,
        "SESSION=abc",
      );

      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json",
          "x-internal": "hidden",
        },
      });
    },
  );

  const result = await resolveEgress(
    { target: "tangle", path: "/api/executions/run-1/state" },
    { query: { include: true } },
  );

  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.deepEqual(result.headers, { "content-type": "application/json" });
  assert.deepEqual(result.json, { ok: true });
});

test("resolves a projects resources path", async () => {
  const expectedBase = new URL(TANGLE_API_URL);
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request) => {
      const url = new URL(String(input));
      assert.equal(url.origin, expectedBase.origin);
      assert.equal(url.pathname, "/api/projects/project-1/resources/");
      return new Response(JSON.stringify({ resources: [] }), {
        headers: { "content-type": "application/json" },
      });
    },
  );

  const result = await resolveEgress({
    target: "tangle",
    path: "/api/projects/project-1/resources/",
  });

  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(result.ok, true);
});

test("resolves a POST to the projects prefix", async () => {
  const expectedBase = new URL(TANGLE_API_URL);
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.origin, expectedBase.origin);
      assert.equal(url.pathname, "/api/projects/");
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({ id: "project-1" }), {
        headers: { "content-type": "application/json" },
      });
    },
  );

  const result = await resolveEgress(
    { target: "tangle", path: "/api/projects/" },
    { method: "POST", body: { name: "new-project" } },
  );

  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.json, { id: "project-1" });
});

test("resolves a PATCH to a project path", async () => {
  const expectedBase = new URL(TANGLE_API_URL);
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.origin, expectedBase.origin);
      assert.equal(url.pathname, "/api/projects/project-1");
      assert.equal(init?.method, "PATCH");
      return new Response(JSON.stringify({ id: "project-1" }), {
        headers: { "content-type": "application/json" },
      });
    },
  );

  const result = await resolveEgress(
    { target: "tangle", path: "/api/projects/project-1" },
    { method: "PATCH", body: { name: "renamed" } },
  );

  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(result.ok, true);
});

test("resolves a read-only workspaces list path", async () => {
  const expectedBase = new URL(TANGLE_API_URL);
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request) => {
      const url = new URL(String(input));
      assert.equal(url.origin, expectedBase.origin);
      assert.equal(url.pathname, "/api/workspaces/");
      return new Response(JSON.stringify({ workspaces: [] }), {
        headers: { "content-type": "application/json" },
      });
    },
  );

  const result = await resolveEgress({
    target: "tangle",
    path: "/api/workspaces/",
  });

  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(result.ok, true);
});

test("rejects a write to the read-only workspaces prefix", async () => {
  await assert.rejects(
    resolveEgress(
      { target: "tangle", path: "/api/workspaces/" },
      { method: "POST" },
    ),
    EgressDeniedError,
  );
});

test("rejects a DELETE to the projects prefix", async () => {
  await assert.rejects(
    resolveEgress(
      { target: "tangle", path: "/api/projects/" },
      { method: "DELETE" },
    ),
    EgressDeniedError,
  );
});

test("rejects a logical target path that is not allowlisted", async () => {
  await assert.rejects(
    resolveEgress({ target: "tangle", path: "/api/private" }),
    EgressDeniedError,
  );
});

test("rejects malformed logical target paths", async () => {
  assert.equal(
    resolveTargetUrl({ target: "tangle", path: "api/executions/run-1/state" }),
    undefined,
  );
  assert.equal(
    resolveTargetUrl({
      target: "tangle",
      path: "//evil.example/api/executions/run-1/state",
    }),
    undefined,
  );
});
