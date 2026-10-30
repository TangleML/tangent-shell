import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { after, test } from "node:test";

import {
  type HostApi,
  type HostApiRoutes,
  startHostApi,
} from "@tangent/local-agent-host/hostApi.ts";

import { runPrimeMcpServer } from "./primeMcpServer.ts";

interface RpcResult {
  content?: { type: string; text: string }[];
  isError?: boolean;
  tools?: { name: string }[];
}

const apis: HostApi[] = [];
after(async () => {
  for (const api of apis) await api.close().catch(() => {});
});

/** A loopback host API recording each report, with an overridable handler. */
async function fakeApi(
  overrides: Partial<HostApiRoutes> = {},
): Promise<{ api: HostApi; calls: unknown[] }> {
  const calls: unknown[] = [];
  const api = await startHostApi({
    put: async () => ({}),
    list: async () => [],
    read: async () => ({ content: "", contentType: "text/plain" }),
    report: async (body) => {
      calls.push(body);
      return { delivered: true };
    },
    ...overrides,
  });
  apis.push(api);
  return { api, calls };
}

/** Drives one prime MCP server over in-memory streams, resolving by id. */
function driver(api: { url: string; token: string }) {
  const input = new PassThrough();
  const output = new PassThrough();
  const pending = new Map<number, (result: RpcResult) => void>();
  let buffer = "";

  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    buffer += chunk;
    for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as { id: number; result: RpcResult };
      pending.get(msg.id)?.(msg.result);
    }
  });

  runPrimeMcpServer({
    hostApiUrl: api.url,
    hostApiToken: api.token,
    input,
    output,
  });

  return (id: number, method: string, params: unknown): Promise<RpcResult> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no response for ${method} (hang)`)),
        2_000,
      );
      pending.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      input.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
}

test("tools/list advertises the message_prime tool", async () => {
  const { api } = await fakeApi();
  const call = driver(api);

  const result = await call(1, "tools/list", {});
  const names = (result.tools ?? []).map((t) => t.name);
  assert.deepEqual(names, ["message_prime"]);
});

test("message_prime forwards the text and reports delivery", async () => {
  const { api, calls } = await fakeApi();
  const call = driver(api);

  const result = await call(1, "tools/call", {
    name: "message_prime",
    arguments: { text: "blocked on credentials" },
  });

  assert.equal(result.isError, undefined);
  assert.match(result.content?.[0]?.text ?? "", /Delivered to Prime/);
  assert.deepEqual(calls, [{ text: "blocked on credentials" }]);
});

test("message_prime rejects an empty text", async () => {
  const { api, calls } = await fakeApi();
  const call = driver(api);

  const result = await call(1, "tools/call", {
    name: "message_prime",
    arguments: {},
  });

  assert.equal(result.isError, true);
  assert.match(result.content?.[0]?.text ?? "", /non-empty/);
  assert.deepEqual(calls, []);
});

test("a host API error surfaces as a tool error (does not hang)", async () => {
  const { api } = await fakeApi({
    report: async () => {
      throw new Error("not attached");
    },
  });
  const call = driver(api);

  const result = await call(1, "tools/call", {
    name: "message_prime",
    arguments: { text: "hi" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content?.[0]?.text ?? "", /not attached/);
});
