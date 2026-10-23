import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { after, test } from "node:test";

import {
  type HostApi,
  type HostApiRoutes,
  startHostApi,
} from "@tangent/local-agent-host/hostApi.ts";

import { runResourceMcpServer } from "./resourceMcpServer.ts";

interface RpcResult {
  content?: { type: string; text: string }[];
  isError?: boolean;
  tools?: { name: string }[];
}

const apis: HostApi[] = [];
after(async () => {
  for (const api of apis) await api.close().catch(() => {});
});

/** A loopback host API recording each call, with overridable canned results. */
async function fakeApi(
  overrides: Partial<HostApiRoutes> = {},
): Promise<{ api: HostApi; calls: [string, unknown][] }> {
  const calls: [string, unknown][] = [];
  const api = await startHostApi({
    put: async (body) => {
      calls.push(["put", body]);
      return { uri: "uploads/report.csv" };
    },
    list: async (body) => {
      calls.push(["list", body]);
      return [{ name: "report.csv", uri: "uploads/report.csv" }];
    },
    read: async (body) => {
      calls.push(["read", body]);
      return {
        content: Buffer.from("hello world").toString("base64"),
        contentType: "text/plain",
      };
    },
    ...overrides,
  });
  apis.push(api);
  return { api, calls };
}

/** Drives one resource MCP server over in-memory streams, resolving by id. */
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

  runResourceMcpServer({
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

test("tools/list advertises the three session-resource tools", async () => {
  const { api } = await fakeApi();
  const call = driver(api);

  const result = await call(1, "tools/list", {});
  const names = (result.tools ?? []).map((t) => t.name);
  assert.deepEqual(names, [
    "put_session_resource",
    "list_session_resources",
    "read_session_resource",
  ]);
});

test("put_session_resource forwards inline content and reports the uri", async () => {
  const { api, calls } = await fakeApi();
  const call = driver(api);

  const result = await call(1, "tools/call", {
    name: "put_session_resource",
    arguments: { path: "report.csv", content: "a,b\n1,2\n" },
  });

  assert.equal(result.isError, undefined);
  assert.match(result.content?.[0]?.text ?? "", /uploads\/report\.csv/);
  const [route, body] = calls[0];
  assert.equal(route, "put");
  assert.deepEqual((body as { input: { kind: string; path: string } }).input, {
    kind: "file",
    path: "report.csv",
    content: "a,b\n1,2\n",
    encoding: "utf8",
    name: "report.csv",
  });
});

test("put_session_resource rejects when neither content nor sourcePath is given", async () => {
  const { api } = await fakeApi();
  const call = driver(api);

  const result = await call(1, "tools/call", {
    name: "put_session_resource",
    arguments: { path: "report.csv" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content?.[0]?.text ?? "", /exactly one/);
});

test("list_session_resources renders the catalog", async () => {
  const { api } = await fakeApi();
  const call = driver(api);

  const result = await call(1, "tools/call", {
    name: "list_session_resources",
    arguments: {},
  });

  assert.equal(result.isError, undefined);
  assert.match(
    result.content?.[0]?.text ?? "",
    /report\.csv \(uploads\/report\.csv\)/,
  );
});

test("read_session_resource decodes base64 to text", async () => {
  const { api, calls } = await fakeApi();
  const call = driver(api);

  const result = await call(1, "tools/call", {
    name: "read_session_resource",
    arguments: { uri: "uploads/report.csv" },
  });

  assert.equal(result.isError, undefined);
  assert.equal(result.content?.[0]?.text, "hello world");
  assert.deepEqual(calls[0], ["read", { uri: "uploads/report.csv" }]);
});

test("a host API error surfaces as a tool error (does not hang)", async () => {
  const { api } = await fakeApi({
    put: async () => {
      throw new Error("too large");
    },
  });
  const call = driver(api);

  const result = await call(1, "tools/call", {
    name: "put_session_resource",
    arguments: { path: "big.bin", content: "x" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content?.[0]?.text ?? "", /too large/);
});
