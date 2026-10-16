import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  connectRemoteEnvironment,
  RemoteEnvironmentClient,
} from "@tangent/remote-subagent";

import { type BridgeOptions, LocalAgentBridge } from "./bridge.ts";
import { createFileTools } from "./remoteFileTools.ts";

type ConnectConfig = Parameters<typeof connectRemoteEnvironment>[0];

class FakeSocket {
  connected = false;
  private readonly handlers = new Map<
    string,
    Array<(...args: unknown[]) => void>
  >();

  on(event: string, handler: (...args: unknown[]) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  emit(): this {
    return this;
  }

  fire(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }
}

interface FakeClient extends RemoteEnvironmentClient {
  socket: RemoteEnvironmentClient["socket"];
  disconnected: boolean;
}

function fakeClient(socket: FakeSocket): FakeClient {
  const client = {
    socket: socket as unknown as RemoteEnvironmentClient["socket"],
    disconnected: false,
    agentEvent() {},
    subagentUpdate() {},
    report() {},
    readRoom: async () => [],
    addResource: async () => {
      throw new Error("not implemented");
    },
    listResources: async () => [],
    readResource: async () => ({ content: "", contentType: "" }),
    disconnect() {
      socket.connected = false;
      client.disconnected = true;
    },
  };
  return client;
}

function buildBridge(
  selector = "projectId:project-a",
  metadata?: Record<string, string>,
): {
  bridge: LocalAgentBridge;
  configs: ConnectConfig[];
  clients: FakeClient[];
} {
  const configs: ConnectConfig[] = [];
  const clients: FakeClient[] = [];
  const options: BridgeOptions = {
    url: "http://shell.test",
    selector,
    ...(metadata ? { metadata } : {}),
    tools: createFileTools(() => "/workspace"),
    piLaunchOptions: async () => ({
      bin: "pi",
      proxyExtensionPath: "/dev/null",
    }),
    log() {},
    onChange() {},
    onSpawned() {},
  };
  const bridge = new LocalAgentBridge(options, (config) => {
    configs.push(config);
    const client = fakeClient(new FakeSocket());
    clients.push(client);
    return client;
  });
  return { bridge, configs, clients };
}

test("connect wires the scoped token and environment into the SDK", () => {
  const { bridge, configs } = buildBridge("projectId:project-a");

  bridge.connect("scoped-token", "vscode-123");

  assert.equal(configs.length, 1);
  const config = configs[0];
  assert.equal(config.url, "http://shell.test");
  assert.equal(config.token, "scoped-token");
  assert.equal(config.environmentId, "vscode-123");
  assert.equal(config.sessionId, undefined);
  assert.deepEqual(Object.keys(config.tools ?? {}).sort(), [
    "find_files",
    "list_dir",
    "read_file",
    "search_text",
  ]);
  assert.equal(bridge.environmentId, "vscode-123");
  assert.equal(bridge.state, "connecting");
});

test("connect forwards the host self-description metadata to the SDK", () => {
  const metadata = {
    description: "Tangent Local Agent in /workspace",
    capabilities: "edits files",
  };
  const { bridge, configs } = buildBridge("projectId:project-a", metadata);

  bridge.connect("scoped-token", "vscode-123");

  assert.deepEqual(configs[0].metadata, metadata);
});

test("connect omits metadata when none is advertised", () => {
  const { bridge, configs } = buildBridge();

  bridge.connect("scoped-token", "vscode-123");

  assert.equal("metadata" in configs[0], false);
});

test("the bridge reports connected once the socket connects", () => {
  const { bridge, clients } = buildBridge();

  bridge.connect("scoped-token", "vscode-123");
  const socket = clients[0].socket as unknown as FakeSocket;
  socket.connected = true;
  socket.fire("connect");

  assert.equal(bridge.state, "connected");
});

test("a token refresh reconnects and disconnects the stale client", () => {
  const { bridge, configs, clients } = buildBridge();

  bridge.connect("token-1", "vscode-123");
  bridge.connect("token-2", "vscode-123");

  assert.equal(configs.length, 2);
  assert.equal(configs[1].token, "token-2");
  assert.equal(clients[0].disconnected, true);
  assert.equal(clients[1].disconnected, false);
});

test("dispose closes the connection and reports disconnected", () => {
  const { bridge, clients } = buildBridge();

  bridge.connect("scoped-token", "vscode-123");
  bridge.dispose();

  assert.equal(clients[0].disconnected, true);
  assert.equal(bridge.state, "disconnected");
});
