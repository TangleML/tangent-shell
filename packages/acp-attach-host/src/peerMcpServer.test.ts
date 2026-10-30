import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { after, test } from "node:test";

import { PeerMailbox, peerSocketPath } from "./peerMailbox.ts";
import { runPeerMcpServer } from "./peerMcpServer.ts";
import { createPeerServer, type PeerServer } from "./peerSocket.ts";

interface RpcResult {
  content?: { type: string; text: string }[];
  isError?: boolean;
}

const servers: PeerServer[] = [];
after(async () => {
  for (const server of servers) await server.close().catch(() => {});
});

/** Drives one MCP server over in-memory streams, resolving responses by id. */
function driver(socketPath: string) {
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

  runPeerMcpServer({ socketPath, input, output });

  /** Sends a request and resolves its result, or rejects if none arrives. */
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

test("peer_send delivers over a live mailbox socket", async () => {
  const path = peerSocketPath(randomUUID());
  const mailbox = new PeerMailbox();
  servers.push(await createPeerServer(path, mailbox));
  const call = driver(path);

  const result = await call(1, "tools/call", {
    name: "peer_send",
    arguments: { text: "hi launcher" },
  });

  assert.equal(result.isError, undefined);
  assert.match(result.content?.[0]?.text ?? "", /Delivered/);
  assert.equal(mailbox.sentCount("agent"), 1);
});

test("peer_send answers (does not hang) when no mailbox is reachable", async () => {
  const call = driver("");

  const result = await call(1, "tools/call", {
    name: "peer_send",
    arguments: { text: "hi" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content?.[0]?.text ?? "", /not reachable/);
});

test("peer_wait answers (does not hang) when no mailbox is reachable", async () => {
  const call = driver("");

  const result = await call(1, "tools/call", {
    name: "peer_wait",
    arguments: { timeoutMs: 50 },
  });

  assert.equal(result.isError, undefined);
  assert.match(result.content?.[0]?.text ?? "", /No message/);
});
