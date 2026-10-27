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

const PIPELINE_ID = "4ece5ec4-d28a-4cf9-83b5-a21e5147f931";
const PIPELINE_WRITE = {
  root_pipeline_task: {
    componentRef: {
      spec: {
        name: "Saved pipeline",
        implementation: { graph: { tasks: {} } },
      },
    },
  },
};

for (const request of [
  { method: "GET", path: "/api/users/me" },
  { method: "PUT", path: "/api/users/me/pipelines" },
  { method: "GET", path: `/api/pipelines/${PIPELINE_ID}` },
  { method: "PUT", path: `/api/pipelines/${PIPELINE_ID}` },
] as const) {
  test(`resolves authenticated ${request.method} ${request.path}`, async () => {
    process.env.TANGLE_TOKEN = "SESSION=trusted";
    const body = request.method === "PUT" ? PIPELINE_WRITE : undefined;
    const query =
      request.path === "/api/users/me/pipelines"
        ? { file_path: "saved/pipeline.yaml" }
        : undefined;
    const expectedHeaders = {
      accept: "application/json",
      cookie: "SESSION=trusted",
      ...(body ? { "content-type": "application/json" } : {}),
    };
    const responseBody = { id: PIPELINE_ID, user_id: "owner@example.com" };
    const fetchMock = mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        assert.ok(init);
        const url = new URL(String(input));
        assert.equal(url.origin, new URL(TANGLE_API_URL).origin);
        assert.equal(url.pathname, request.path);
        assert.equal(init.method, request.method);
        assert.deepEqual(init.headers, expectedHeaders);
        assert.equal(init.body, JSON.stringify(body));
        assert.equal(
          url.searchParams.get("file_path"),
          query?.file_path ?? null,
        );
        return new Response(JSON.stringify(responseBody), {
          headers: { "content-type": "application/json" },
        });
      },
    );

    const result = await resolveEgress(
      { target: "tangle", path: request.path },
      {
        method: request.method,
        body,
        query,
        headers: {
          Accept: "application/json",
          CoOkIe: "SESSION=untrusted",
          Authorization: "Bearer untrusted",
          "X-Alternate-Credential": "untrusted",
          "X-Forwarded-Email": "another-user@example.com",
          "X-Auth-User": "another-user@example.com",
        },
      },
    );

    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(result.ok, true);
    assert.deepEqual(result.json, responseBody);
  });
}

test("does not use caller credentials when server credentials are absent", async () => {
  mock.method(
    globalThis,
    "fetch",
    async (_input: string | URL | Request, init?: RequestInit) => {
      assert.deepEqual(init?.headers, { accept: "application/json" });
      return new Response(
        JSON.stringify({ detail: "Authentication required" }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      );
    },
  );

  const result = await resolveEgress(
    { target: "tangle", path: "/api/users/me" },
    { headers: { cookie: "SESSION=untrusted", AUTHORIZATION: "Bearer user" } },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

for (const status of [401, 403, 422, 500]) {
  test(`preserves saved-pipeline backend errors with HTTP ${status}`, async () => {
    const errorBody = { detail: `Backend rejected the request (${status})` };
    mock.method(globalThis, "fetch", async () => {
      return new Response(JSON.stringify(errorBody), {
        status,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await resolveEgress(
      { target: "tangle", path: "/api/users/me/pipelines" },
      { method: "PUT", body: { root_pipeline_task: {} } },
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, status);
    assert.deepEqual(result.json, errorBody);
  });
}

test("rejects pipeline endpoints beyond the narrow saved-pipeline contract", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new Error("A denied destination must not be fetched");
  });

  for (const request of [
    { method: "PUT", path: "/api/users/another-user/pipelines" },
    { method: "PUT", path: `/api/users/me/pipelines/${PIPELINE_ID}` },
    { method: "PUT", path: `/api/pipelines/${PIPELINE_ID}/properties` },
    { method: "PUT", path: "/api/pipelines" },
    { method: "PUT", path: "/api/pipelines/search" },
    { method: "PUT", path: "/api/pipelines/not-a-uuid" },
    { method: "DELETE", path: `/api/pipelines/${PIPELINE_ID}` },
    { method: "POST", path: "/api/users/me/pipelines" },
    { method: "PUT", path: "/api/users/me" },
  ] as const) {
    await assert.rejects(
      resolveEgress(
        { target: "tangle", path: request.path },
        { method: request.method },
      ),
      EgressDeniedError,
    );
  }

  assert.equal(fetchMock.mock.calls.length, 0);
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
