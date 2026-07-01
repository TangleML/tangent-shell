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
