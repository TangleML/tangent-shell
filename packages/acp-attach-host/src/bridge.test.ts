import assert from "node:assert/strict";
import { test } from "node:test";

import type { McpServer, SessionNotification } from "@agentclientprotocol/sdk";
import type {
  HostApi,
  HostApiRoutes,
} from "@tangent/local-agent-host/hostApi.ts";

import type { AcpSession } from "./acpSession.ts";
import type { AttachClient, AttachDelivery } from "./attachClient.ts";
import { AttachBridge, type AttachBridgeOptions } from "./bridge.ts";
import { PeerMailbox } from "./peerMailbox.ts";

/** A client whose deliveries resolve once, then park — isolating the peer path. */
function fakeClient(
  deliveries: AttachDelivery[],
  polledWith: string[] = [],
): AttachClient {
  let served = false;
  const client = {
    register: async () => "agent-1",
    deliveries: async (agentId: string) => {
      polledWith.push(agentId);
      if (served) return new Promise<AttachDelivery[]>(() => {});
      served = true;
      return deliveries;
    },
    openRun: async () => "run-1",
    endRun: async () => {},
    pushEvent: async () => {},
    setStatus: async () => {},
  };
  return client as unknown as AttachClient;
}

/** A one-shot deferred, for gating a prompt mid-turn. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function chunk(text: string): SessionNotification["update"] {
  return {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  } as SessionNotification["update"];
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("condition not met in time");
}

test("an idle launcher message runs as a turn and its reply returns", async () => {
  const mailbox = new PeerMailbox();
  const prompts: string[] = [];
  const bridge = new AttachBridge({
    client: fakeClient([]),
    command: { bin: "x", args: [] },
    cwd: ".",
    name: "worker",
    peer: { mailbox },
    createSession: (_options, callbacks) =>
      ({
        start: async () => {},
        prompt: async (text: string) => {
          prompts.push(text);
          callbacks.onUpdate(chunk("hello back"));
          return "end_turn";
        },
        cancel: async () => {},
        dispose: () => {},
      }) as unknown as AcpSession,
  });

  await bridge.start();
  mailbox.send("parent", "ping");

  assert.deepEqual(await mailbox.take("agent", 1_000), { text: "hello back" });
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /ping/);
  await bridge.dispose();
});

test("the bridge polls deliveries scoped to its own agent id", async () => {
  const polledWith: string[] = [];
  const bridge = new AttachBridge({
    client: fakeClient([], polledWith),
    command: { bin: "x", args: [] },
    cwd: ".",
    name: "worker",
    createSession: () =>
      ({
        start: async () => {},
        prompt: async () => "end_turn",
        cancel: async () => {},
        dispose: () => {},
      }) as unknown as AcpSession,
  });

  await bridge.start();
  await waitFor(() => polledWith.length > 0);
  assert.equal(polledWith[0], "agent-1");
  await bridge.dispose();
});

test("a launcher message sent during a turn waits until that turn ends", async () => {
  const mailbox = new PeerMailbox();
  const prompts: string[] = [];
  const gate = deferred();
  const started = deferred();
  const bridge = new AttachBridge({
    client: fakeClient([{ agentId: "agent-1", text: "work" }]),
    command: { bin: "x", args: [] },
    cwd: ".",
    name: "worker",
    peer: { mailbox },
    createSession: () =>
      ({
        start: async () => {},
        prompt: async (text: string) => {
          prompts.push(text);
          if (prompts.length === 1) {
            started.resolve();
            await gate.promise;
          }
          return "end_turn";
        },
        cancel: async () => {},
        dispose: () => {},
      }) as unknown as AcpSession,
  });

  await bridge.start();
  await started.promise;

  mailbox.send("parent", "interrupt");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /work/);

  gate.resolve();
  await waitFor(() => prompts.length === 2);
  assert.match(prompts[1], /interrupt/);
  await bridge.dispose();
});

/** A client recording resource writes and returning canned reads. */
function resourceClient(
  added: { agentId: string; input: unknown }[],
): AttachClient {
  return {
    register: async () => "agent-7",
    deliveries: async () => new Promise<AttachDelivery[]>(() => {}),
    openRun: async () => "run-1",
    endRun: async () => {},
    pushEvent: async () => {},
    setStatus: async () => {},
    addResource: async (agentId: string, input: unknown) => {
      added.push({ agentId, input });
      return { uri: "uploads/x" };
    },
    listResources: async () => [{ name: "x", uri: "uploads/x" }],
    readResource: async () => ({ content: "aGk=", contentType: "text/plain" }),
  } as unknown as AttachClient;
}

interface ResourceHarness {
  mcpServers: McpServer[];
  routes: HostApiRoutes;
  added: { agentId: string; input: unknown }[];
  dispose: () => Promise<void>;
}

/** Starts a bridge with session resources, capturing its MCP servers + routes. */
async function startResourceBridge(): Promise<ResourceHarness> {
  const added: { agentId: string; input: unknown }[] = [];
  const hostApi: HostApi = {
    url: "http://127.0.0.1:1",
    token: "tok",
    close: async () => {},
  };
  let routes: HostApiRoutes | undefined;
  const startApi = (r: HostApiRoutes): Promise<HostApi> => {
    routes = r;
    return Promise.resolve(hostApi);
  };
  let mcpServers: McpServer[] = [];
  const bridge = new AttachBridge({
    client: resourceClient(added),
    command: { bin: "x", args: [] },
    cwd: ".",
    name: "worker",
    resources: { mcpCommand: { bin: "node", args: ["cli", "resource-mcp"] } },
    startHostApi: startApi as AttachBridgeOptions["startHostApi"],
    createSession: (options) => {
      mcpServers = options.mcpServers ?? [];
      return {
        start: async () => {},
        prompt: async () => "end_turn",
        cancel: async () => {},
        dispose: () => {},
      } as unknown as AcpSession;
    },
  });
  await bridge.start();
  assert.ok(routes, "the host API was started");
  return { mcpServers, routes, added, dispose: () => bridge.dispose() };
}

test("session resources offer the resource MCP server with the loopback url", async () => {
  const h = await startResourceBridge();
  const server = h.mcpServers.find(
    (s) => s.name === "tangent-session-resources",
  );
  assert.ok(
    server && "command" in server,
    "the resource MCP server is offered over stdio",
  );
  assert.deepEqual(server.args, [
    "cli",
    "resource-mcp",
    "--host-api-url",
    "http://127.0.0.1:1",
    "--host-api-token",
    "tok",
  ]);
  assert.ok(
    server.env?.some(
      (e) =>
        e.name === "TANGENT_HOST_API_URL" && e.value === "http://127.0.0.1:1",
    ),
  );
  await h.dispose();
});

test("the loopback resource routes forward to the attach client", async () => {
  const h = await startResourceBridge();

  const put = await h.routes.put({
    input: { kind: "file", path: "x", content: "hi" },
  });
  assert.deepEqual(put, { uri: "uploads/x" });
  assert.deepEqual(h.added, [
    { agentId: "agent-7", input: { kind: "file", path: "x", content: "hi" } },
  ]);

  assert.deepEqual(await h.routes.list({}), [{ name: "x", uri: "uploads/x" }]);
  assert.deepEqual(await h.routes.read({ uri: "uploads/x" }), {
    content: "aGk=",
    contentType: "text/plain",
  });

  await h.dispose();
});
