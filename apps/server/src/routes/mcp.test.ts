import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir before importing modules that read
// config at load time.
const ROOT = mkdtempSync(path.join(tmpdir(), "mcp-relay-rest-"));
process.env.SESSIONS_ROOT = ROOT;

const express = (await import("express")).default;
const { createMcpRelayRouter } = await import("./mcp.ts");
const { RelayRegistry } = await import("../mcp/relayRegistry.ts");

import type { CorrelationEngine } from "../conversation/correlation.ts";
import type { RelayReport } from "../mcp/relayReport.ts";

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
  rmSync(ROOT, { recursive: true, force: true });
});

/** A running express app mounting the relay route over a seeded channel. */
async function serve() {
  const registry = new RelayRegistry();
  const { channelId, secret } = registry.open({
    sessionId: "s1",
    label: "Explorer",
  });

  const report: RelayReport = async () => {};
  const correlations = {} as unknown as CorrelationEngine;

  const app = express();
  app.use(express.json());
  app.use("/api/mcp", createMcpRelayRouter(registry, report, correlations));

  const server = app.listen(0);
  cleanups.push(() => server.close());
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/mcp`;

  const authed = { authorization: `Bearer ${secret}` };

  return { base, channelId, authed };
}

test("GET declines the SSE stream with 405 and Allow: POST", async () => {
  const { base, channelId, authed } = await serve();
  const res = await fetch(`${base}/${channelId}`, { headers: authed });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "POST");
  assert.notEqual(res.headers.get("content-type"), "text/event-stream");
});

test("GET an unknown channel is a 404", async () => {
  const { base } = await serve();
  const res = await fetch(`${base}/does-not-exist`);
  assert.equal(res.status, 404);
});

test("GET with a bad bearer is a 401", async () => {
  const { base, channelId } = await serve();
  const res = await fetch(`${base}/${channelId}`, {
    headers: { authorization: "Bearer wrong" },
  });
  assert.equal(res.status, 401);
});

test("POST initialize still returns a JSON-RPC result", async () => {
  const { base, channelId, authed } = await serve();
  const res = await fetch(`${base}/${channelId}`, {
    method: "POST",
    headers: { ...authed, "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    jsonrpc: string;
    id: number;
    result?: { protocolVersion?: string };
  };
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, 1);
  assert.equal(body.result?.protocolVersion, "2024-11-05");
});
