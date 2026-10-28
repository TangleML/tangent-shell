import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { afterEach, mock, test } from "node:test";

import express from "express";

import { INTERNAL_TOKEN, TANGLE_API_URL, TANGLE_TEAM_HEADER } from "../config.ts";
import { createAgentBundlesRouter } from "../routes/agentBundles.ts";
import { createInternalEgressRouter } from "../routes/internalEgress.ts";
import { RunRegistry } from "../runs/runRegistry.ts";
import type { AgentBundleStore } from "../store/agentBundleStore.ts";
import { InMemoryRunStore } from "../store/inMemoryRunStore.ts";
import {
  EgressDeniedError,
  EgressUpstreamError,
  resolveEgress,
  resolveEgressWithTeam,
  resolveTargetUrl,
} from "./egressAllowlist.ts";

const resolveAgentEgress = (
  input: Parameters<typeof resolveEgress>[0],
  init?: Parameters<typeof resolveEgress>[1],
) => resolveEgress(input, init, "agent");

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
  { method: "GET", path: "/api/users/me/pipelines" },
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

    const result = await resolveAgentEgress(
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

  const result = await resolveAgentEgress(
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

    const result = await resolveAgentEgress(
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
      resolveAgentEgress(
        { target: "tangle", path: request.path },
        { method: request.method },
      ),
      EgressDeniedError,
    );
  }

  assert.equal(fetchMock.mock.calls.length, 0);
});

test("denies identity and saved-pipeline endpoints to the default UI caller", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new Error("A denied destination must not be fetched");
  });

  for (const request of [
    { method: "GET", path: "/api/users/me" },
    { method: "PUT", path: "/api/users/me/pipelines" },
    { method: "PUT", path: `/api/pipelines/${PIPELINE_ID}` },
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

test("resolves a secrets list with server-side credentials", async () => {
  process.env.TANGLE_TOKEN = "SESSION=abc";
  const expectedBase = new URL(TANGLE_API_URL);
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.origin, expectedBase.origin);
      assert.equal(url.pathname, "/api/secrets/");
      assert.equal(init?.method, "GET");
      assert.equal(
        (init?.headers as Record<string, string> | undefined)?.cookie,
        "SESSION=abc",
      );
      return new Response(JSON.stringify({ secrets: [] }), {
        headers: { "content-type": "application/json" },
      });
    },
  );

  const result = await resolveEgress({
    target: "tangle",
    path: "/api/secrets/",
  });

  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.json, { secrets: [] });
});

test("rejects every secrets request other than the list", async () => {
  const denied = [
    { method: "POST", path: "/api/secrets/" },
    { method: "PUT", path: "/api/secrets/API_KEY" },
    { method: "DELETE", path: "/api/secrets/API_KEY" },
    { method: "GET", path: "/api/secrets/API_KEY" },
  ] as const;

  for (const { method, path } of denied) {
    await assert.rejects(
      resolveEgress({ target: "tangle", path }, { method }),
      EgressDeniedError,
      `${method} ${path}`,
    );
  }
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

async function postEgress(url: string, body: unknown, token?: string) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

test("saved-pipeline access is denied through public UI egress even with a forged caller", async () => {
  process.env.TANGLE_TOKEN = "SESSION=trusted";
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      if (new URL(String(input)).origin !== new URL(TANGLE_API_URL).origin)
        return originalFetch(input, init);
      upstreamCalls += 1;
      assert.equal(new Headers(init?.headers).get("cookie"), "SESSION=trusted");
      return Response.json({});
    },
  );
  const app = express().use(express.json());
  app.use(
    "/api/agent-bundles",
    createAgentBundlesRouter({} as AgentBundleStore),
  );
  app.use(
    "/internal/egress",
    createInternalEgressRouter(
      () => undefined,
      new RunRegistry(new InMemoryRunStore()),
    ),
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = {
    input: { target: "tangle", path: `/api/pipelines/${PIPELINE_ID}` },
    init: { method: "PUT", body: PIPELINE_WRITE, caller: "agent" },
    caller: "agent",
  };
  try {
    for (const path of [
      "/api/users/me",
      "/api/users/me/pipelines",
      `/api/pipelines/${PIPELINE_ID}`,
    ]) {
      for (const method of ["GET", "PUT"]) {
        const response = await postEgress(
          `${base}/api/agent-bundles/ui-egress`,
          {
            ...request,
            input: { ...request.input, path },
            init: { ...request.init, method },
          },
        );
        assert.equal(response.status, 403);
      }
    }
    const unauthorized = await postEgress(`${base}/internal/egress`, request);
    assert.deepEqual([unauthorized.status, upstreamCalls], [401, 0]);
    const authorized = await postEgress(
      `${base}/internal/egress`,
      request,
      INTERNAL_TOKEN,
    );
    assert.deepEqual([authorized.status, upstreamCalls], [200, 1]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("upstream diagnostics explain configuration and timeout failures without exposing secrets", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const detail = "https://private:credential@example.com?token=secret";
  mock.method(globalThis, "fetch", async () => {
    throw new Error(detail, { cause: { code: "ECONNREFUSED" } });
  });
  await assert.rejects(
    resolveAgentEgress({ target: "tangle", path: "/api/users/me" }),
    (error: unknown) => {
      assert.ok(error instanceof EgressUpstreamError);
      assert.match(error.message, /TANGLE_API_URL/);
      assert.equal(error.message.includes(detail), false);
      assert.equal(error.message.includes("credential"), false);
      return true;
    },
  );
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => {
    throw new DOMException("aborted", "AbortError");
  });
  await assert.rejects(
    resolveAgentEgress({ target: "tangle", path: "/api/users/me" }),
    /timed out/,
  );

  const logged = warn.mock.calls.map((call) => String(call.arguments[0]));
  assert.match(
    logged[0] ?? "",
    /^\[egress\] GET \S+\/api\/users\/me failed: Error \(ECONNREFUSED\)$/,
  );
  assert.match(logged[1] ?? "", /failed: AbortError$/);
  for (const line of logged) {
    assert.equal(line.includes("credential"), false);
    assert.equal(line.includes("secret"), false);
  }
});

test("the upstream timeout remains active while reading a stalled response body", async (t) => {
  t.mock.method(console, "warn", () => {});
  t.mock.timers.enable({ apis: ["setTimeout"] });
  mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, init: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init.signal!.addEventListener("abort", () => {
              controller.error(new DOMException("aborted", "AbortError"));
            });
          },
        }),
      ),
  );
  const rejected = assert.rejects(
    resolveAgentEgress({ target: "tangle", path: "/api/users/me" }),
    /timed out/,
  );
  await Promise.resolve();
  t.mock.timers.tick(10_000);
  await rejected;
});

/** Captures the headers of the one outbound fetch a call makes. */
function captureHeaders(status = 200): () => Record<string, string> {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    Response.json({}, { status }),
  );
  return () => {
    const init = fetchMock.mock.calls[0]?.arguments[1];
    return (init?.headers ?? {}) as Record<string, string>;
  };
}

test("a team-scoped rule acts as, and reports, the caller's acting team", async () => {
  const headers = captureHeaders();

  const { appliedTeam } = await resolveEgressWithTeam(
    { target: "tangle", path: "/api/secrets/" },
    {},
    "agent",
    { actingTeam: "team-a" },
  );

  assert.equal(headers()[TANGLE_TEAM_HEADER], "team-a");
  assert.equal(appliedTeam, "team-a");
});

test("a team-scoped rule without an acting team sends and reports no team", async () => {
  const headers = captureHeaders();

  const { appliedTeam } = await resolveEgressWithTeam({
    target: "tangle",
    path: "/api/secrets/",
  });

  assert.equal(headers()[TANGLE_TEAM_HEADER], undefined);
  assert.equal(appliedTeam, undefined);
});

test("a rule that is not team-scoped never carries or reports the team", async () => {
  const headers = captureHeaders();

  const { appliedTeam } = await resolveEgressWithTeam(
    { target: "tangle", path: "/api/executions/run-1/state" },
    {},
    "agent",
    { actingTeam: "team-a" },
  );

  assert.equal(headers()[TANGLE_TEAM_HEADER], undefined);
  assert.equal(appliedTeam, undefined);
});

test("a caller cannot supply its own team header", async () => {
  const forged = { headers: { [TANGLE_TEAM_HEADER.toUpperCase()]: "team-x" } };
  const teamHeaders = (headers: Record<string, string>) =>
    Object.entries(headers).filter(
      ([name]) => name.toLowerCase() === TANGLE_TEAM_HEADER,
    );

  const ungranted = captureHeaders();
  const ungrantedResult = await resolveEgressWithTeam(
    { target: "tangle", path: "/api/secrets/" },
    forged,
  );
  assert.deepEqual(teamHeaders(ungranted()), []);
  assert.equal(ungrantedResult.appliedTeam, undefined);
  mock.reset();

  const granted = captureHeaders();
  const grantedResult = await resolveEgressWithTeam(
    { target: "tangle", path: "/api/secrets/" },
    forged,
    "agent",
    { actingTeam: "team-a" },
  );
  assert.deepEqual(teamHeaders(granted()), [[TANGLE_TEAM_HEADER, "team-a"]]);
  assert.equal(grantedResult.appliedTeam, "team-a");
});

test("the applied team is reported when upstream refuses it", async () => {
  const headers = captureHeaders(401);

  const { response, appliedTeam } = await resolveEgressWithTeam(
    { target: "tangle", path: "/api/pipeline_runs/" },
    { method: "POST", body: {} },
    "agent",
    { actingTeam: "team-a" },
  );

  assert.equal(response.status, 401);
  assert.equal(headers()[TANGLE_TEAM_HEADER], "team-a");
  assert.equal(appliedTeam, "team-a");
});
