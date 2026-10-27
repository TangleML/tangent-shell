import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { afterEach, mock, test } from "node:test";

import express from "express";

import {
  savePipeline,
  type SavePipelineInput,
} from "../../../../examples/tangle-oss/lib/savedPipeline.ts";
import { resolveEgress } from "../bundleUi/egressAllowlist.ts";
import { INTERNAL_TOKEN, TANGLE_API_URL } from "../config.ts";
import { createInternalEgressRouter } from "../routes/internalEgress.ts";

const PIPELINE_ID = "71c26504-e061-4edb-a2f8-846bc960f8b2";
const CALLER = "writer@example.com";
const definition = {
  componentRef: {
    spec: {
      name: "Training pipeline",
      implementation: {
        graph: {
          tasks: {
            train: {
              componentRef: {
                spec: {
                  name: "Train",
                  implementation: {
                    container: {
                      image: "python:3.12",
                      command: ["python", "-c"],
                      args: ["print('trained')"],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
const input: SavePipelineInput = {
  file_path: "pipelines/training.yaml",
  root_pipeline_task: definition,
  pipeline_run_annotations: { purpose: "training" },
};

function savedDocument(body: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: PIPELINE_ID,
    user_id: CALLER,
    pipeline_name: "Training pipeline",
    file_path: input.file_path,
    version: "sha256:definition",
    current_version: "sha256:definition",
    versioning_mode: "disabled",
    ...(body as Record<string, unknown>),
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const egress = (path: string, init?: Parameters<typeof resolveEgress>[1]) =>
  resolveEgress({ target: "tangle", path }, init);

function backend(
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>,
) {
  const originalFetch = globalThis.fetch;
  return mock.method(
    globalThis,
    "fetch",
    (request: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(request));
      if (url.origin !== new URL(TANGLE_API_URL).origin)
        return originalFetch(request, init);
      return Promise.resolve(handler(url, init));
    },
  );
}

afterEach(() => {
  delete process.env.TANGLE_TOKEN;
  mock.restoreAll();
});

test("saves a complete definition without an editor and returns authoritative identity and UI target", async () => {
  process.env.TANGLE_TOKEN = "SESSION=trusted-writer";
  let persisted: unknown;
  const calls: string[] = [];
  backend((url, init) => {
    calls.push(url.pathname);
    assert.equal(
      new Headers(init.headers).get("cookie"),
      "SESSION=trusted-writer",
    );
    if (url.pathname === "/api/users/me")
      return jsonResponse({ id: CALLER, permissions: ["read", "write"] });
    if (url.pathname === "/api/users/me/pipelines") {
      assert.equal(init.method, "PUT");
      assert.equal(url.searchParams.get("file_path"), input.file_path);
      persisted = JSON.parse(String(init.body));
      assert.deepEqual(persisted, {
        root_pipeline_task: definition,
        pipeline_run_annotations: input.pipeline_run_annotations,
      });
      // The backend owns identity canonicalization (including case-insensitive upserts).
      return jsonResponse(
        savedDocument(persisted, { user_id: CALLER.toUpperCase() }),
      );
    }
    assert.equal(url.pathname, "/api/projects/project-1/resources/");
    assert.deepEqual(JSON.parse(String(init.body)), {
      entity: "pipeline",
      entity_id: PIPELINE_ID,
      name: "Training pipeline",
    });
    assert.ok(
      persisted,
      "association happens only after saving the definition",
    );
    return jsonResponse(
      { id: "resource-1", entity: "pipeline", entity_id: PIPELINE_ID },
      201,
    );
  });

  const result = await savePipeline(egress, {
    ...input,
    project_id: "project-1",
  });
  assert.equal(result.saved, true);
  assert.equal(result.id, PIPELINE_ID);
  assert.equal(result.name, "Training pipeline");
  assert.equal(result.user_id, CALLER.toUpperCase());
  assert.equal(result.authenticated_user_id, CALLER);
  assert.equal(result.target, `pipeline://remote/${PIPELINE_ID}`);
  assert.deepEqual(result.project, { id: "project-1", attached: true });
  assert.deepEqual(calls, [
    "/api/users/me",
    "/api/users/me/pipelines",
    "/api/projects/project-1/resources/",
  ]);
});

test("updates by stable ID using backend permissions and preserves the versioning policy", async () => {
  backend((url, init) => {
    if (url.pathname === "/api/users/me")
      return jsonResponse({ id: CALLER, permissions: ["write"] });
    assert.equal(url.pathname.toLowerCase(), `/api/pipelines/${PIPELINE_ID}`);
    assert.equal(url.search, "");
    const body = JSON.parse(String(init.body));
    assert.equal("versioning_mode" in body, false);
    return jsonResponse(
      savedDocument(body, {
        user_id: "owner@example.com",
        versioning_mode: "enabled",
      }),
    );
  });
  const result = await savePipeline(egress, {
    pipeline_id: PIPELINE_ID.toUpperCase(),
    root_pipeline_task: definition,
  });
  assert.equal(result.user_id, "owner@example.com");
  assert.equal(result.authenticated_user_id, CALLER);
  assert.equal(result.versioning_mode, "enabled");
});

test("requires a single locator and an embedded named spec before any API request", async () => {
  const fetchMock = backend(() => {
    throw new Error("must not fetch");
  });
  await assert.rejects(
    savePipeline(egress, { ...input, pipeline_id: PIPELINE_ID }),
    /exactly one/,
  );
  await assert.rejects(
    savePipeline(egress, { root_pipeline_task: definition }),
    /exactly one/,
  );
  await assert.rejects(
    savePipeline(egress, {
      ...input,
      root_pipeline_task: {
        componentRef: { url: "https://example.com/pipeline.yaml" },
      },
    }),
    /named embedded/,
  );
  assert.equal(fetchMock.mock.calls.length, 0);
});

test("refuses missing or read-only authentication before saving", async () => {
  let status = 401;
  const fetchMock = backend(() =>
    status === 401
      ? jsonResponse({ detail: "Authenticate first" }, 401)
      : jsonResponse({ id: CALLER, permissions: ["read"] }),
  );
  await assert.rejects(
    savePipeline(egress, input),
    /HTTP 401.*Authenticate first/,
  );
  status = 200;
  await assert.rejects(
    savePipeline(egress, input),
    /does not have write permission/,
  );
  assert.equal(fetchMock.mock.calls.length, 2);
});

test("surfaces backend denied writes, invalid definitions and failures without attaching or claiming saved", async () => {
  for (const [status, detail] of [
    [403, "pipeline:update denied"],
    [422, "Unknown task output"],
    [500, "Storage unavailable"],
  ] as const) {
    const fetchMock = backend((url) =>
      url.pathname === "/api/users/me"
        ? jsonResponse({ id: CALLER, permissions: ["write"] })
        : jsonResponse({ detail, code: "backend_error" }, status),
    );
    await assert.rejects(
      savePipeline(egress, {
        pipeline_id: PIPELINE_ID,
        root_pipeline_task: definition,
        project_id: "project-1",
      }),
      new RegExp(`HTTP ${status}.*${detail}`),
    );
    assert.equal(fetchMock.mock.calls.length, 2);
    fetchMock.mock.restore();
  }
});

test("does not confirm unexpected saved identity or an unusable returned definition", async () => {
  for (const overrides of [
    { file_path: "wrong.yaml" },
    { id: undefined },
    { root_pipeline_task: { componentRef: { digest: "sha256:reference" } } },
  ]) {
    const fetchMock = backend((url) =>
      url.pathname === "/api/users/me"
        ? jsonResponse({ id: CALLER, permissions: ["write"] })
        : jsonResponse(
            savedDocument({ root_pipeline_task: definition }, overrides),
          ),
    );
    await assert.rejects(
      savePipeline(egress, input),
      /different pipeline|returned no|named embedded/,
    );
    fetchMock.mock.restore();
  }
});

test("reports a saved pipeline separately when project attachment fails", async () => {
  backend((url, init) => {
    if (url.pathname === "/api/users/me")
      return jsonResponse({ id: CALLER, permissions: ["write"] });
    if (init.method === "PUT")
      return jsonResponse(savedDocument(JSON.parse(String(init.body))));
    return jsonResponse({ detail: "Project not found" }, 404);
  });
  const result = await savePipeline(egress, {
    ...input,
    project_id: "missing-project",
  });
  assert.equal(result.saved, true);
  assert.equal(result.id, PIPELINE_ID);
  assert.equal(result.project?.attached, false);
  assert.match(result.project?.error ?? "", /HTTP 404.*Project not found/);
});

test("recognizes a confirmed existing project attachment on retry, including later pages", async () => {
  backend((url, init) => {
    if (url.pathname === "/api/users/me")
      return jsonResponse({ id: CALLER, permissions: ["write"] });
    if (init.method === "PUT")
      return jsonResponse(savedDocument(JSON.parse(String(init.body))));
    if (init.method === "POST")
      return jsonResponse({ detail: "Reference already attached" }, 409);
    assert.equal(url.searchParams.get("entity"), "pipeline");
    return jsonResponse(
      url.searchParams.has("page_token")
        ? {
            resources: [{ entity: "pipeline", entity_id: PIPELINE_ID }],
            next_page_token: null,
          }
        : { resources: [], next_page_token: "next" },
    );
  });
  const result = await savePipeline(egress, {
    ...input,
    project_id: "project-1",
  });
  assert.equal(result.project?.attached, true);
});

test("preserves an unconfirmed attachment conflict and a transport failure", async () => {
  backend((url, init) => {
    if (url.pathname === "/api/users/me")
      return jsonResponse({ id: CALLER, permissions: ["write"] });
    if (init.method === "PUT")
      return jsonResponse(savedDocument(JSON.parse(String(init.body))));
    return init.method === "POST"
      ? jsonResponse({ detail: "Unrelated conflict" }, 409)
      : jsonResponse({ resources: [] });
  });
  const result = await savePipeline(egress, {
    ...input,
    project_id: "project-1",
  });
  assert.equal(result.project?.attached, false);
  assert.match(result.project?.error ?? "", /HTTP 409.*Unrelated conflict/);
  await assert.rejects(
    savePipeline(async () => {
      throw new Error("Connection lost");
    }, input),
    /Connection lost.*persistence is unconfirmed/,
  );
});

test("an in-flight API write survives its requesting connection closing", async () => {
  let finish!: () => void;
  let started!: () => void;
  const writing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const release = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let upstreamSignal: AbortSignal | undefined;
  let persisted: unknown;
  backend(async (_url, init) => {
    upstreamSignal = init.signal ?? undefined;
    started();
    await release;
    persisted = JSON.parse(String(init.body));
    return jsonResponse(savedDocument(persisted));
  });
  const app = express();
  app.use(express.json());
  app.use("/internal/egress", createInternalEgressRouter());
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const connection = new AbortController();
  try {
    const pending = fetch(`http://127.0.0.1:${port}/internal/egress`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${INTERNAL_TOKEN}`,
      },
      body: JSON.stringify({
        input: { target: "tangle", path: "/api/users/me/pipelines" },
        init: {
          method: "PUT",
          query: { file_path: input.file_path },
          body: { root_pipeline_task: definition },
        },
      }),
      signal: connection.signal,
    });
    await writing;
    connection.abort();
    await assert.rejects(pending, /abort/i);
    assert.equal(upstreamSignal?.aborted, false);
    finish();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(persisted, { root_pipeline_task: definition });
    assert.equal(upstreamSignal?.aborted, false);
  } finally {
    finish();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
