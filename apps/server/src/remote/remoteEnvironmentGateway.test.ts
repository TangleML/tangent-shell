import assert from "node:assert/strict";
import { test } from "node:test";

import { connectorFor, type SubagentInfo } from "@tangent/shared/contracts.ts";
import {
  type RemoteAgentEventPayload,
  RemoteEnvEvents,
  type RemoteSpawnCommand,
  type RemoteToolCallRequest,
} from "@tangent/shared/remoteSubagent.ts";
import type { Server as SocketIOServer, Socket } from "socket.io";

import {
  HandshakeTokenCredential,
  ScopedTokenCredential,
} from "../connectors/credentials.ts";
import type { ResolvedSessionConfig } from "../pi/agentConfig.ts";
import type { ConversationEventSink } from "../pi/types.ts";
import { RunRegistry } from "../runs/runRegistry.ts";
import { InMemoryRunStore } from "../store/inMemoryRunStore.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import { RemoteEnvironmentGateway } from "./remoteEnvironmentGateway.ts";

/** Lets a fire-and-forget roster replay settle before asserting on it. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** The environment token this harness's gateway is configured with. */
const ENV_TOKEN = "test-env-token";
/** HMAC secret for scoped tokens in this harness. */
const SCOPED_SECRET = "test-signing-secret";

/** One thing an environment's socket was sent, with any ack callback. */
interface SentEntry {
  event: string;
  payload: unknown;
  ack?: (err: Error | null, response: unknown) => void;
}

/** An environment's socket: what it was sent, and what it listens for. */
function fakeSocket(auth: Record<string, unknown>) {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const sent: SentEntry[] = [];
  const emit = (event: string, payload: unknown, ack?: unknown) =>
    sent.push({
      event,
      payload,
      ack: ack as SentEntry["ack"],
    });
  const socket = {
    handshake: { auth },
    data: {} as Record<string, unknown>,
    connected: true,
    on: (event: string, handler: (...args: unknown[]) => void) =>
      listeners.set(event, handler),
    emit,
    // The ack path (`socket.timeout(ms).emit(event, payload, cb)`) chains off a
    // timeout; the fake ignores the duration and reuses the same emit.
    timeout: () => ({ emit }),
    disconnect: () => listeners.get("disconnect")?.(undefined),
  } as unknown as Socket;
  return { socket, listeners, sent };
}

interface HarnessOptions {
  scoped?: ScopedTokenCredential;
  sessionConfig?: (sessionId: string) => ResolvedSessionConfig | undefined;
}

/** Captures Socket.IO namespace middleware so tests can drive connect/auth. */
function fakeNamespace() {
  let onConnection: ((socket: Socket) => void) | undefined;
  let authenticate:
    | ((socket: Socket, next: (err?: Error) => void) => void)
    | undefined;
  return {
    namespace: {
      use: (fn: (socket: Socket, next: (err?: Error) => void) => void) => {
        authenticate = fn;
      },
      on: (event: string, handler: (socket: Socket) => void) => {
        if (event === "connection") onConnection = handler;
      },
    },
    connect(
      environmentId: string,
      auth: { token?: string } = { token: ENV_TOKEN },
    ) {
      const { socket, listeners, sent } = fakeSocket({
        environmentId,
        ...auth,
      });
      let refused: Error | undefined;
      authenticate?.(socket, (err) => {
        refused = err;
      });
      if (!refused) onConnection?.(socket);
      return {
        refused,
        sent,
        send: (event: string, payload: unknown) =>
          listeners.get(event)?.(payload),
        disconnect: () => listeners.get("disconnect")?.(undefined),
      };
    },
  };
}

function relayHandlers(
  rosterUpdates: SubagentInfo[],
  agentEvents: Array<{ sessionId: string; agentId: string }>,
): ConversationEventSink {
  return {
    onAgentEvent: (sessionId, agent) => {
      agentEvents.push({ sessionId, agentId: agent.agentId });
    },
    onSubagentUpdate: (_sessionId, info) => rosterUpdates.push(info),
    onAgentMessage: () => {},
    onSessionStatus: () => {},
  };
}

/**
 * A gateway wired to a fake namespace, plus a `connect` that registers an
 * environment by driving the captured middleware and then the captured
 * connection handler — so every test goes through the real credential check,
 * presenting the right token unless it asks not to. The returned handle drives
 * the environment's inbound events and its disconnect.
 */
function makeHarness(options: HarnessOptions = {}) {
  const { namespace, connect } = fakeNamespace();
  const rosterUpdates: SubagentInfo[] = [];
  const agentEvents: Array<{ sessionId: string; agentId: string }> = [];
  const store = new InMemorySessionStore();
  const runStore = new InMemoryRunStore();
  const runs = new RunRegistry(runStore);
  const gateway = new RemoteEnvironmentGateway(
    { of: () => namespace } as unknown as SocketIOServer,
    relayHandlers(rosterUpdates, agentEvents),
    store,
    runs,
    new HandshakeTokenCredential(ENV_TOKEN),
    options.scoped ?? new ScopedTokenCredential(SCOPED_SECRET),
    options.sessionConfig,
  );
  return {
    gateway,
    connect,
    store,
    runs,
    runStore,
    rosterUpdates,
    agentEvents,
  };
}

function lastSpawn(
  sent: Array<{ event: string; payload: unknown }>,
): RemoteSpawnCommand {
  const spawn = sent.findLast((entry) => entry.event === RemoteEnvEvents.Spawn);
  assert.ok(spawn);
  return spawn.payload as RemoteSpawnCommand;
}

function mintScoped(
  scoped: ScopedTokenCredential,
  environmentId: string,
  sessionId: string,
): string {
  return scoped.mint({
    environmentId,
    sessionId,
    sub: "user@example.com",
  }).token;
}

/** Seeds a persisted remote roster row hosted by `environmentId`. */
async function seedAgent(
  store: InMemorySessionStore,
  sessionId: string,
  id: string,
  environmentId: string,
  status: SubagentInfo["status"] = "active",
): Promise<void> {
  await store.recordAgent(sessionId, {
    id,
    role: "subagent",
    name: id,
    status,
    host: "remote",
    connector: connectorFor("remote-env", environmentId),
  });
}

test("only an environment presenting the connector's credential connects", () => {
  const h = makeHarness();

  assert.ok(h.connect("intruder", { token: "wrong-token" }).refused);
  assert.ok(h.connect("silent", {}).refused);
  assert.equal(h.gateway.hasConnectedEnvironment(), false);

  assert.equal(h.connect("env-1").refused, undefined);
  assert.equal(h.gateway.hasConnectedEnvironment(), true);
});

test("the remote roster describes its connector and environment", () => {
  const h = makeHarness();
  h.connect("env-1");

  const { info } = h.gateway.spawnSubagent("s1", { name: "Worker" });

  const expected = {
    kind: "remote-env",
    lifecycle: "owned",
    spawnAuthority: "remote-env",
    credentialScheme: "shared-token",
    environmentId: "env-1",
  };
  assert.deepEqual(info.connector, expected);
  assert.equal(info.host, "remote");
  assert.deepEqual(h.gateway.listSubagents("s1")[0].connector, expected);
});

test("a disconnecting environment detaches its sub-agents and keeps their tabs", async () => {
  const h = makeHarness();
  const env = h.connect("env-1");
  const { info } = h.gateway.spawnSubagent("s1", { name: "Worker" });
  h.gateway.sendToAgent({
    sessionId: "s1",
    agentId: info.id,
    text: "go",
    ingress: "tool",
  });
  const runId = h.runs.current("s1", info.id)?.id;
  assert.ok(runId);

  env.disconnect();

  // The tab survives: "the far end is gone" is not a kill, and the entry has to
  // exist for the environment to reattach to.
  assert.equal(h.gateway.hasAgent("s1", info.id), true);
  assert.equal(h.gateway.listSubagents("s1")[0].status, "detached");
  assert.equal(h.rosterUpdates.at(-1)?.status, "detached");
  assert.equal((await h.runStore.getRun(runId))?.status, "failed");
});

test("a detached participant refuses delivery instead of dropping it silently", () => {
  const h = makeHarness();
  const env = h.connect("env-1");
  const { info } = h.gateway.spawnSubagent("s1", { name: "Worker" });

  const send = (text: string) =>
    h.gateway.sendToAgent({ sessionId: "s1", agentId: info.id, text });

  assert.equal(send("hello"), true);
  env.disconnect();

  assert.equal(send("hello again"), false);
});

test("a reconnecting environment gets its persisted roster replayed as detached", async () => {
  const h = makeHarness();
  await seedAgent(h.store, "s1", "remote-1", "env-1");
  await seedAgent(h.store, "s1", "remote-done", "env-1", "completed");
  await seedAgent(h.store, "s2", "other-env", "env-2");

  h.connect("env-1");
  await flush();

  // Only this environment's non-terminal rows come back, and none of them claims
  // to be live: the protocol cannot ask what the far side still runs.
  assert.deepEqual(
    h.gateway.listSubagents("s1").map((s) => [s.id, s.status]),
    [["remote-1", "detached"]],
  );
  assert.deepEqual(h.gateway.listSubagents("s2"), []);
});

test("a detached participant reattaches when its environment streams again", async () => {
  const h = makeHarness();
  await seedAgent(h.store, "s1", "remote-1", "env-1");

  const env = h.connect("env-1");
  await flush();
  assert.equal(h.gateway.listSubagents("s1")[0].status, "detached");

  env.send(RemoteEnvEvents.AgentEvent, {
    sessionId: "s1",
    agentId: "remote-1",
    event: { type: "start", messageId: "m1" },
  } satisfies RemoteAgentEventPayload);

  assert.equal(h.gateway.listSubagents("s1")[0].status, "active");
});

test("reattach ignores a row that never recorded its environment", async () => {
  const h = makeHarness();
  await h.store.recordAgent("s1", {
    id: "legacy-1",
    role: "subagent",
    name: "legacy",
    status: "active",
    host: "remote",
  });

  h.gateway.reattach("s1", (await h.store.listAgents("s1"))[0]);

  // Pre-connector-column rows never recorded which environment hosted them, so
  // there is nothing to reattach them to.
  assert.deepEqual(h.gateway.listSubagents("s1"), []);
});

test("a scoped token is accepted and a wrong HMAC is refused", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const token = mintScoped(scoped, "env-scoped", "s1");

  assert.ok(h.connect("ignored", { token: "re1.payload.garbage" }).refused);
  assert.equal(h.connect("ignored", { token }).refused, undefined);
  assert.equal(h.gateway.hasConnectedEnvironment(), true);
});

test("an expired scoped token is refused", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET, 0);
  const h = makeHarness({ scoped });
  const token = mintScoped(scoped, "env-scoped", "s1");

  assert.ok(h.connect("ignored", { token }).refused);
});

test("a scoped connection ignores the handshake environmentId", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const token = mintScoped(scoped, "env-real", "s1");
  const env = h.connect("spoofed", { token });

  const { info } = h.gateway.spawnSubagent("s1", { name: "Worker" });

  assert.equal(info.connector.environmentId, "env-real");
  assert.equal(lastSpawn(env.sent).sessionId, "s1");
});

test("scoped environments only receive spawns for their bound session", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const envA = h.connect("ignored-a", {
    token: mintScoped(scoped, "env-a", "sA"),
  });
  const envB = h.connect("ignored-b", {
    token: mintScoped(scoped, "env-b", "sB"),
  });

  h.gateway.spawnSubagent("sA", { name: "WorkerA" });
  h.gateway.spawnSubagent("sB", { name: "WorkerB" });

  assert.equal(lastSpawn(envA.sent).sessionId, "sA");
  assert.equal(lastSpawn(envB.sent).sessionId, "sB");
  assert.equal(envA.sent.length, 1);
  assert.equal(envB.sent.length, 1);
});

test("a scoped environment never receives another session's spawn", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const envA = h.connect("ignored-a", {
    token: mintScoped(scoped, "env-a", "sA"),
  });

  assert.throws(
    () => h.gateway.spawnSubagent("sB", { name: "WorkerB" }),
    /No remote environment is connected/,
  );
  assert.equal(envA.sent.length, 0);
});

test("an unscoped environment still receives spawns for an unbound session", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const legacy = h.connect("env-legacy");
  h.connect("ignored-a", { token: mintScoped(scoped, "env-a", "sA") });

  h.gateway.spawnSubagent("sA", { name: "ScopedWorker" });
  h.gateway.spawnSubagent("sB", { name: "LegacyWorker" });

  assert.equal(lastSpawn(legacy.sent).sessionId, "sB");
  assert.equal(lastSpawn(legacy.sent).name, "LegacyWorker");
});

test("a scoped environment's inbound events for another session are dropped", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  h.connect("env-legacy");
  const { info } = h.gateway.spawnSubagent("s2", { name: "Worker" });
  const scopedEnv = h.connect("ignored-a", {
    token: mintScoped(scoped, "env-a", "s1"),
  });

  scopedEnv.send(RemoteEnvEvents.AgentEvent, {
    sessionId: "s2",
    agentId: info.id,
    event: { type: "start", messageId: "m1" },
  } satisfies RemoteAgentEventPayload);

  assert.deepEqual(h.agentEvents, []);
});

test("a remote spawn resolves tools and prompt from the session's editor template", () => {
  const templates = new Map([
    [
      "editor",
      {
        name: "editor",
        description: "",
        tools: ["csom_edit"],
        systemPrompt: "You edit the spec.",
      },
    ],
  ]);
  const sessionConfig = (): ResolvedSessionConfig => ({
    prime: { tools: [], appendSystemPrompt: "" },
    subagentDefaults: {},
    templates,
    skillPaths: [],
    workflowPaths: [],
    extensionPaths: [],
  });
  const h = makeHarness({ sessionConfig });
  const env = h.connect("env-1");

  h.gateway.spawnSubagent("s1", { name: "Editor", template: "editor" });

  const command = lastSpawn(env.sent);
  assert.ok(command.tools.includes("csom_edit"));
  assert.match(command.systemPrompt, /You edit the spec\./);
  assert.equal(command.template, "editor");
});

const ECHO_TOOL = {
  name: "echo",
  description: "Echo the input back.",
  inputSchema: { type: "object" },
};

test("an environment's registered tools are listed for its session", () => {
  const h = makeHarness();
  const env = h.connect("env-1");

  assert.deepEqual(h.gateway.listTools("s1"), []);

  env.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [ECHO_TOOL],
  });

  assert.deepEqual(h.gateway.listTools("s1"), [ECHO_TOOL]);
});

test("re-registering replaces the prior catalog", () => {
  const h = makeHarness();
  const env = h.connect("env-1");
  env.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [ECHO_TOOL],
  });

  env.send(RemoteEnvEvents.ToolsRegister, { sessionId: "s1", tools: [] });

  assert.deepEqual(h.gateway.listTools("s1"), []);
});

test("a tool call routes to the environment and resolves with its result", async () => {
  const h = makeHarness();
  const env = h.connect("env-1");
  env.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [ECHO_TOOL],
  });

  const pending = h.gateway.callTool("s1", "prime", "echo", { text: "hi" });
  const call = env.sent.findLast((e) => e.event === RemoteEnvEvents.ToolsCall);
  assert.ok(call);
  const request = call.payload as RemoteToolCallRequest;
  assert.equal(request.name, "echo");
  assert.equal(request.agentId, "prime");
  assert.deepEqual(request.arguments, { text: "hi" });
  call.ack?.(null, { ok: true, result: "hi" });

  assert.deepEqual(await pending, { ok: true, result: "hi" });
});

test("calling a tool no environment registered rejects", async () => {
  const h = makeHarness();
  const env = h.connect("env-1");
  env.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [ECHO_TOOL],
  });

  await assert.rejects(
    () => h.gateway.callTool("s1", "prime", "missing", {}),
    /No remote tool named "missing"/,
  );
});

test("calling a tool with no environment connected rejects", async () => {
  const h = makeHarness();

  await assert.rejects(
    () => h.gateway.callTool("s1", "prime", "echo", {}),
    /No remote environment is connected/,
  );
});

test("a disconnecting environment drops its tool catalog", () => {
  const h = makeHarness();
  const env = h.connect("env-1");
  env.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [ECHO_TOOL],
  });

  env.disconnect();

  assert.deepEqual(h.gateway.listTools("s1"), []);
});

test("a scoped environment cannot register tools for another session", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const env = h.connect("ignored", {
    token: mintScoped(scoped, "env-a", "sA"),
  });

  env.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "sB",
    tools: [ECHO_TOOL],
  });

  assert.deepEqual(h.gateway.listTools("sA"), []);
});
