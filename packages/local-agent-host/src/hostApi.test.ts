import assert from "node:assert/strict";
import { after, test } from "node:test";

import { type HostApi, type HostApiRoutes, startHostApi } from "./hostApi.ts";

const started: HostApi[] = [];
after(async () => {
  for (const api of started) await api.close();
});

async function serve(routes: Partial<HostApiRoutes>): Promise<HostApi> {
  const api = await startHostApi({
    put: async () => ({}),
    list: async () => [],
    read: async () => ({}),
    ...routes,
  });
  started.push(api);
  return api;
}

async function post(
  api: HostApi,
  route: string,
  body: unknown,
  token = api.token,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${api.url}/${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

test("forwards a put body to the route and acks its result", async () => {
  const seen: unknown[] = [];
  const api = await serve({
    put: async (body) => {
      seen.push(body);
      return { uri: "uploads/x.txt" };
    },
  });

  const res = await post(api, "put", { sessionId: "s", input: { a: 1 } });

  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true, result: { uri: "uploads/x.txt" } });
  assert.deepEqual(seen, [{ sessionId: "s", input: { a: 1 } }]);
});

test("rejects a request without the bearer token", async () => {
  const api = await serve({});

  const res = await post(api, "put", {}, "");

  assert.equal(res.status, 401);
  assert.equal(res.json.ok, false);
});

test("404s an unknown route", async () => {
  const api = await serve({});

  const res = await post(api, "nope", {});

  assert.equal(res.status, 404);
});

test("wraps a thrown route error as a 400 ack", async () => {
  const api = await serve({
    read: async () => {
      throw new Error("boom");
    },
  });

  const res = await post(api, "read", { uri: "x" });

  assert.equal(res.status, 400);
  assert.deepEqual(res.json, { ok: false, error: "boom" });
});
