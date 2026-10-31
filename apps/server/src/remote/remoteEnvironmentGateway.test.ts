import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  type ChatMessage,
  connectorFor,
  SocketEvents,
  type SubagentInfo,
} from "@tangent/shared/contracts.ts";
import {
  type RemoteAgentEventPayload,
  RemoteEnvEvents,
  type RemoteRoomReadResponse,
  type RemoteSpawnCommand,
  type RemoteSubagentUpdatePayload,
  type RemoteToolCallRequest,
} from "@tangent/shared/remoteSubagent.ts";
import type { Server as SocketIOServer, Socket } from "socket.io";

import {
  HandshakeTokenCredential,
  ScopedTokenCredential,
} from "../connectors/credentials.ts";
import type { ResolvedSessionConfig } from "../pi/agentConfig.ts";
import type { AgentEvent, ConversationEventSink } from "../pi/types.ts";
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
    id: `socket-${String(auth.environmentId)}`,
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
      auth: { token?: string; metadata?: Record<string, unknown> } = {
        token: ENV_TOKEN,
      },
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
        send: (event: string, ...args: unknown[]) =>
          listeners.get(event)?.(...args),
        disconnect: () => listeners.get("disconnect")?.(undefined),
      };
    },
  };
}

function relayHandlers(
  rosterUpdates: SubagentInfo[],
  agentEvents: Array<{ sessionId: string; agentId: string; event: AgentEvent }>,
): ConversationEventSink {
  return {
    onAgentEvent: (sessionId, agent, event) => {
      agentEvents.push({ sessionId, agentId: agent.agentId, event });
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
  const agentEvents: Array<{
    sessionId: string;
    agentId: string;
    event: AgentEvent;
  }> = [];
  const store = new InMemorySessionStore();
  const runStore = new InMemoryRunStore();
  const runs = new RunRegistry(runStore);
  const broadcasts: Array<{ event: string; payload: unknown }> = [];
  const io = {
    of: () => namespace,
    emit: (event: string, payload: unknown) =>
      broadcasts.push({ event, payload }),
  };
  const gateway = new RemoteEnvironmentGateway(
    io as unknown as SocketIOServer,
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
    broadcasts,
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
  sub = "user@example.com",
): string {
  return scoped.mint({
    environmentId,
    sessionId,
    sub,
  }).token;
}

/** A selector-scoped token: a `sub` + `selector`, bound to no single session. */
function mintSelector(
  scoped: ScopedTokenCredential,
  environmentId: string,
  selector: string,
  sub = "user@example.com",
): string {
  return scoped.mint({ environmentId, selector, sub }).token;
}

/** A user-scoped token: a `sub` with neither a session nor a selector. */
function mintUser(
  scoped: ScopedTokenCredential,
  environmentId: string,
  sub = "user@example.com",
): string {
  return scoped.mint({ environmentId, sub }).token;
}

/** Counts the ToolsCall commands an environment's socket was sent. */
function toolCalls(sent: SentEntry[]): SentEntry[] {
  return sent.filter((entry) => entry.event === RemoteEnvEvents.ToolsCall);
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
    connector: connectorFor("remote-env", environmentId),
  });
}

/** Seeds one transcript message so a room read has a tail to return. */
async function seedMessage(
  store: InMemorySessionStore,
  sessionId: string,
  content: string,
): Promise<void> {
  const message: ChatMessage = {
    id: randomUUID(),
    sessionId,
    conversationId: "prime",
    seq: 1,
    author: { id: "prime", kind: "agent", name: "Prime" },
    mentions: [],
    source: { kind: "agent" },
    content,
    createdAt: new Date().toISOString(),
  };
  await store.appendMessage(message);
}

/** Drives a room read and resolves with the host's ack response. */
function readRoom(
  env: { send: (event: string, ...args: unknown[]) => void },
  sessionId: string,
): Promise<RemoteRoomReadResponse> {
  return new Promise((resolve) => {
    env.send(RemoteEnvEvents.RoomRead, { sessionId }, resolve);
  });
}

/** An owner identity for a session whose access is restricted to members. */
function owner(email: string) {
  return { email, first_name: "O", last_name: "wner" };
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

test("killing a remote sub-agent clears its activity indicator", () => {
  const h = makeHarness();
  h.connect("env-1");
  const { info } = h.gateway.spawnSubagent("s1", { name: "Worker" });

  h.gateway.killAgent("s1", info.id);

  // The protocol has no run-end event, so the gateway has to clear the activity
  // itself or a last tool indicator (e.g. "Running send_to_prime") lingers.
  assert.deepEqual(h.agentEvents.at(-1), {
    sessionId: "s1",
    agentId: info.id,
    event: { type: "activity", activity: null },
  });
});

test("a terminal remote status clears the activity indicator", () => {
  const h = makeHarness();
  const env = h.connect("env-1");
  const { info } = h.gateway.spawnSubagent("s1", { name: "Worker" });

  env.send(RemoteEnvEvents.SubagentUpdate, {
    sessionId: "s1",
    agentId: info.id,
    status: "completed",
  } satisfies RemoteSubagentUpdatePayload);

  assert.deepEqual(h.agentEvents.at(-1), {
    sessionId: "s1",
    agentId: info.id,
    event: { type: "activity", activity: null },
  });
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

test("the owner may direct their own local sub-agent", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  h.connect("env-a", { token: mintScoped(scoped, "env-a", "s1", "alice@x") });

  const { info } = h.gateway.spawnSubagent("s1", {
    name: "Editor",
    audienceParticipantId: "alice@x",
  });

  assert.equal(h.gateway.canDirectSubagent("s1", info.id, "alice@x"), true);
});

test("a non-owner may not direct another person's local sub-agent", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  h.connect("env-a", { token: mintScoped(scoped, "env-a", "s1", "alice@x") });

  const { info } = h.gateway.spawnSubagent("s1", {
    name: "Editor",
    audienceParticipantId: "alice@x",
  });

  assert.equal(h.gateway.canDirectSubagent("s1", info.id, "bob@x"), false);
});

test("an agent-originated delivery to a local sub-agent is not owner-gated", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  h.connect("env-a", { token: mintScoped(scoped, "env-a", "s1", "alice@x") });

  const { info } = h.gateway.spawnSubagent("s1", {
    name: "Editor",
    audienceParticipantId: "alice@x",
  });

  assert.equal(h.gateway.canDirectSubagent("s1", info.id, undefined), true);
});

test("an unscoped dev host's sub-agent is not owner-gated", () => {
  const h = makeHarness();
  h.connect("env-1");

  const { info } = h.gateway.spawnSubagent("s1", { name: "Worker" });

  assert.equal(h.gateway.canDirectSubagent("s1", info.id, "anyone@x"), true);
});

test("a sub-agent whose environment is gone defers the owner gate", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const env = h.connect("env-a", {
    token: mintScoped(scoped, "env-a", "s1", "alice@x"),
  });

  const { info } = h.gateway.spawnSubagent("s1", {
    name: "Editor",
    audienceParticipantId: "alice@x",
  });
  env.disconnect();

  assert.equal(h.gateway.canDirectSubagent("s1", info.id, "bob@x"), true);
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
    connector: connectorFor("remote-env"),
  });

  h.gateway.reattach("s1", (await h.store.listAgents("s1"))[0]);

  // A remote row that never recorded which environment hosted it has no
  // environment to reattach to.
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

  const { info } = h.gateway.spawnSubagent("s1", {
    name: "Worker",
    audienceParticipantId: "user@example.com",
  });

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

  h.gateway.spawnSubagent("sA", {
    name: "WorkerA",
    audienceParticipantId: "user@example.com",
  });
  h.gateway.spawnSubagent("sB", {
    name: "WorkerB",
    audienceParticipantId: "user@example.com",
  });

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

  h.gateway.spawnSubagent("sA", {
    name: "ScopedWorker",
    audienceParticipantId: "user@example.com",
  });
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
    binPaths: [],
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

const FOO_TOOL = {
  name: "foo",
  description: "Do foo.",
  inputSchema: { type: "object" },
};

const BAR_TOOL = {
  name: "bar",
  description: "Do bar.",
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

test("an unscoped tab host with an empty catalog does not hide the session's workarea", async () => {
  const h = makeHarness();
  const workarea = h.connect("s1:workarea");
  workarea.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [ECHO_TOOL],
  });
  h.connect("s1:tab");

  assert.deepEqual(h.gateway.listTools("s1"), [ECHO_TOOL]);

  const pending = h.gateway.callTool("s1", "prime", "echo", { text: "hi" });
  const call = toolCalls(workarea.sent).at(-1);
  assert.ok(call, "the workarea host received the call, not the empty tab");
  call.ack?.(null, { ok: true, result: "hi" });

  assert.deepEqual(await pending, { ok: true, result: "hi" });
});

test("an unscoped host prefixed with a session never serves another session", async () => {
  const h = makeHarness();
  const workarea = h.connect("s1:workarea");
  workarea.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [ECHO_TOOL],
  });

  await assert.rejects(
    () => h.gateway.callTool("s2", "prime", "echo", {}),
    /No remote environment is connected/,
  );
  assert.equal(toolCalls(workarea.sent).length, 0, "s1's host is untouched");
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

  assert.deepEqual(h.gateway.listTools("sA", "user@example.com"), []);
});

test("two people's hosts on one session all stay connected", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const alice1 = h.connect("x", {
    token: mintScoped(scoped, "env-a1", "s1", "alice@x"),
  });
  const alice2 = h.connect("x", {
    token: mintScoped(scoped, "env-a2", "s1", "alice@x"),
  });
  const bob = h.connect("x", {
    token: mintScoped(scoped, "env-b", "s1", "bob@x"),
  });

  alice1.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [ECHO_TOOL],
  });
  alice2.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [FOO_TOOL],
  });
  bob.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [BAR_TOOL],
  });

  // The third connect kicked no one: the union of Alice's two hosts survives.
  assert.deepEqual(
    h.gateway
      .listTools("s1", "alice@x")
      .map((t) => t.name)
      .sort(),
    ["echo", "foo"],
  );
  assert.deepEqual(
    h.gateway.listTools("s1", "bob@x").map((t) => t.name),
    ["bar"],
  );
});

test("a tool call reaches the prompting person's host only", async () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const alice = h.connect("x", {
    token: mintScoped(scoped, "env-a", "s1", "alice@x"),
  });
  const bob = h.connect("x", {
    token: mintScoped(scoped, "env-b", "s1", "bob@x"),
  });
  alice.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [ECHO_TOOL],
  });
  bob.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [ECHO_TOOL],
  });

  const pending = h.gateway.callTool(
    "s1",
    "prime",
    "echo",
    { text: "hi" },
    "alice@x",
  );
  const call = toolCalls(alice.sent).at(-1);
  assert.ok(call);
  assert.equal(toolCalls(bob.sent).length, 0, "Bob's host is untouched");
  call.ack?.(null, { ok: true, result: "hi" });

  assert.deepEqual(await pending, { ok: true, result: "hi" });
});

test("a call rejects when the prompting person's host has left", async () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const alice = h.connect("x", {
    token: mintScoped(scoped, "env-a", "s1", "alice@x"),
  });
  const bob = h.connect("x", {
    token: mintScoped(scoped, "env-b", "s1", "bob@x"),
  });
  alice.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [ECHO_TOOL],
  });
  bob.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [ECHO_TOOL],
  });

  alice.disconnect();

  await assert.rejects(
    () => h.gateway.callTool("s1", "prime", "echo", {}, "alice@x"),
    /prompting user's host is not connected/,
  );
  assert.equal(
    toolCalls(bob.sent).length,
    0,
    "Bob's catalog is not a fallback",
  );
});

test("the most recent registration of a name wins within a person's hosts", async () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const first = h.connect("x", {
    token: mintScoped(scoped, "env-a1", "s1", "alice@x"),
  });
  const second = h.connect("x", {
    token: mintScoped(scoped, "env-a2", "s1", "alice@x"),
  });
  first.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [ECHO_TOOL],
  });
  second.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [ECHO_TOOL],
  });

  const pending = h.gateway.callTool("s1", "prime", "echo", {}, "alice@x");
  assert.equal(toolCalls(second.sent).length, 1, "the newer host is called");
  assert.equal(toolCalls(first.sent).length, 0);
  toolCalls(second.sent)[0].ack?.(null, { ok: true, result: "ok" });
  await pending;
});

test("a remote spawn lands in the prompting person's environment", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const alice = h.connect("x", {
    token: mintScoped(scoped, "env-a", "s1", "alice@x"),
  });
  const bob = h.connect("x", {
    token: mintScoped(scoped, "env-b", "s1", "bob@x"),
  });

  h.gateway.spawnSubagent("s1", {
    name: "Editor",
    audienceParticipantId: "bob@x",
  });

  assert.equal(lastSpawn(bob.sent).sessionId, "s1");
  assert.equal(
    alice.sent.filter((e) => e.event === RemoteEnvEvents.Spawn).length,
    0,
    "Alice's environment gets no spawn",
  );
});

test("a remote spawn with no known audience does not guess among hosts", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const alice = h.connect("x", {
    token: mintScoped(scoped, "env-a", "s1", "alice@x"),
  });
  const bob = h.connect("x", {
    token: mintScoped(scoped, "env-b", "s1", "bob@x"),
  });

  assert.throws(
    () => h.gateway.spawnSubagent("s1", { name: "Editor" }),
    /prompting user's host is not connected/,
  );
  assert.equal(
    alice.sent.filter((e) => e.event === RemoteEnvEvents.Spawn).length,
    0,
  );
  assert.equal(
    bob.sent.filter((e) => e.event === RemoteEnvEvents.Spawn).length,
    0,
  );
});

test("a targeted spawn lands in the named host, not the most recent", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const first = h.connect("x", {
    token: mintScoped(scoped, "env-a1", "s1", "alice@x"),
  });
  const second = h.connect("x", {
    token: mintScoped(scoped, "env-a2", "s1", "alice@x"),
  });

  h.gateway.spawnSubagent("s1", {
    name: "Editor",
    audienceParticipantId: "alice@x",
    environmentId: "env-a1",
  });

  assert.equal(lastSpawn(first.sent).sessionId, "s1");
  assert.equal(
    second.sent.filter((e) => e.event === RemoteEnvEvents.Spawn).length,
    0,
    "the most recent host gets no spawn when another is targeted",
  );
});

test("a spawn with no environmentId falls back to the most recent host", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const first = h.connect("x", {
    token: mintScoped(scoped, "env-a1", "s1", "alice@x"),
  });
  const second = h.connect("x", {
    token: mintScoped(scoped, "env-a2", "s1", "alice@x"),
  });

  h.gateway.spawnSubagent("s1", {
    name: "Editor",
    audienceParticipantId: "alice@x",
  });

  assert.equal(lastSpawn(second.sent).sessionId, "s1");
  assert.equal(
    first.sent.filter((e) => e.event === RemoteEnvEvents.Spawn).length,
    0,
  );
});

test("a targeted spawn with an unknown environmentId throws naming the valid hosts", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const alice = h.connect("x", {
    token: mintScoped(scoped, "env-a", "s1", "alice@x"),
  });

  assert.throws(
    () =>
      h.gateway.spawnSubagent("s1", {
        name: "Editor",
        audienceParticipantId: "alice@x",
        environmentId: "env-missing",
      }),
    /ineligible environmentId "env-missing".*env-a/s,
  );
  assert.equal(
    alice.sent.filter((e) => e.event === RemoteEnvEvents.Spawn).length,
    0,
    "no spawn lands when the targeted host is invalid",
  );
});

test("a targeted spawn cannot reach another person's host", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  h.connect("x", { token: mintScoped(scoped, "env-a", "s1", "alice@x") });
  const bob = h.connect("x", {
    token: mintScoped(scoped, "env-b", "s1", "bob@x"),
  });

  assert.throws(
    () =>
      h.gateway.spawnSubagent("s1", {
        name: "Editor",
        audienceParticipantId: "alice@x",
        environmentId: "env-b",
      }),
    /ineligible environmentId "env-b"/,
  );
  assert.equal(
    bob.sent.filter((e) => e.event === RemoteEnvEvents.Spawn).length,
    0,
  );
});

test("listEnvironmentsFor returns only the prompting person's hosts with their metadata", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  h.connect("x", {
    token: mintScoped(scoped, "env-a", "s1", "alice@x"),
    metadata: { description: "Alice's editor", capabilities: "edits files" },
  });
  h.connect("x", { token: mintScoped(scoped, "env-b", "s1", "bob@x") });

  const listed = h.gateway.listEnvironmentsFor("s1", "alice@x");

  assert.deepEqual(
    listed.map((e) => e.environmentId),
    ["env-a"],
  );
  assert.deepEqual(listed[0].metadata, {
    description: "Alice's editor",
    capabilities: "edits files",
  });
});

test("listEnvironmentsFor is empty when the prompting person has no host", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  h.connect("x", { token: mintScoped(scoped, "env-b", "s1", "bob@x") });

  assert.deepEqual(h.gateway.listEnvironmentsFor("s1", "alice@x"), []);
});

test("a call with no known audience does not guess among connected hosts", async () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const alice = h.connect("x", {
    token: mintScoped(scoped, "env-a", "s1", "alice@x"),
  });
  alice.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [ECHO_TOOL],
  });

  await assert.rejects(
    () => h.gateway.callTool("s1", "prime", "echo", {}),
    /prompting user's host is not connected/,
  );
  assert.equal(toolCalls(alice.sent).length, 0);
});

test("an environmentId stays claimed by its owner after they disconnect", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const alice = h.connect("x", {
    token: mintScoped(scoped, "env-a", "s1", "alice@x"),
  });

  alice.disconnect();

  assert.equal(
    h.gateway.environmentClaimedByOther("env-a", "bob@x"),
    true,
    "Bob cannot reuse Alice's id once she has left",
  );
  assert.equal(
    h.gateway.environmentClaimedByOther("env-a", "alice@x"),
    false,
    "Alice can still reclaim her own id",
  );
});

test("listEnvironments lists a session's scoped hosts and its dev hosts, newest first", () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const alice = h.connect("x", {
    token: mintScoped(scoped, "env-a", "s1", "alice@x"),
  });
  h.connect("vscode-generic");
  h.connect("x", { token: mintScoped(scoped, "env-b", "s2", "bob@x") });

  alice.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: "s1",
    tools: [ECHO_TOOL],
  });
  h.gateway.spawnSubagent("s1", {
    name: "Worker",
    audienceParticipantId: "alice@x",
  });

  assert.deepEqual(h.gateway.listEnvironments("s1"), [
    {
      environmentId: "vscode-generic",
      sessionId: undefined,
      selector: undefined,
      owner: undefined,
      scoped: false,
      toolCount: 0,
      subagentCount: 0,
    },
    {
      environmentId: "env-a",
      sessionId: "s1",
      selector: undefined,
      owner: "alice@x",
      scoped: true,
      toolCount: 1,
      subagentCount: 1,
    },
  ]);
  assert.deepEqual(
    h.gateway.listEnvironments("s2").map((e) => e.environmentId),
    ["env-b", "vscode-generic"],
  );
});

test("listEnvironments surfaces the metadata a host advertised on connect", () => {
  const h = makeHarness();
  h.connect("vscode-1", {
    token: ENV_TOKEN,
    metadata: { windowName: "my-ws", editor: "Cursor" },
  });

  assert.deepEqual(h.gateway.listEnvironments("s1")[0].metadata, {
    windowName: "my-ws",
    editor: "Cursor",
  });
});

test("listEnvironments drops malformed metadata and omits it entirely when empty", () => {
  const h = makeHarness();
  h.connect("vscode-1", {
    token: ENV_TOKEN,
    metadata: { windowName: "ok", bad: 42, nested: { x: 1 } },
  });
  h.connect("vscode-2", { token: ENV_TOKEN, metadata: { bad: 42 } });

  const one = h.gateway.listEnvironments("s1");
  const first = one.find((e) => e.environmentId === "vscode-1");
  const second = one.find((e) => e.environmentId === "vscode-2");
  assert.deepEqual(first?.metadata, { windowName: "ok" });
  assert.equal("metadata" in (second ?? {}), false);
});

test("a session-pinned dev host replaces the generic one for its session only", () => {
  const h = makeHarness();
  h.connect("s1:vscode-1");
  h.connect("vscode-generic");

  assert.deepEqual(
    h.gateway.listEnvironments("s1").map((e) => e.environmentId),
    ["s1:vscode-1"],
  );
  assert.deepEqual(
    h.gateway.listEnvironments("s2").map((e) => e.environmentId),
    ["vscode-generic"],
  );
});

test("environment changes are broadcast and reflected in the list", async () => {
  const h = makeHarness();
  const updates = () =>
    h.broadcasts.filter((b) => b.event === SocketEvents.EnvironmentUpdate)
      .length;

  const env = h.connect("env-1");
  await flush();
  assert.equal(updates(), 1, "connect");

  const { info } = h.gateway.spawnSubagent("s1", { name: "Worker" });
  assert.equal(h.gateway.listEnvironments("s1")[0].subagentCount, 1);
  h.gateway.killAgent("s1", info.id);
  assert.equal(h.gateway.listEnvironments("s1")[0].subagentCount, 0);
  assert.equal(updates(), 3, "spawn and kill");

  env.disconnect();
  assert.equal(updates(), 4, "disconnect");
  assert.deepEqual(h.gateway.listEnvironments("s1"), []);
});

test("evictDisconnected reaps an environment whose socket died without a disconnect", () => {
  const h = makeHarness();
  h.connect("env-1");
  h.gateway.spawnSubagent("s1", { name: "Worker" });
  assert.equal(h.gateway.listEnvironments("s1").length, 1);

  // A half-open socket the ping timeout closed without firing `disconnect`: the
  // env is still in the roster but its socket reports gone.
  const environments = (
    h.gateway as unknown as {
      environments: Map<string, { socket: { connected: boolean } }>;
    }
  ).environments;
  const stale = environments.get("env-1");
  assert.ok(stale);
  stale.socket.connected = false;

  h.gateway.evictDisconnected();

  assert.deepEqual(h.gateway.listEnvironments("s1"), []);
  assert.equal(h.gateway.listSubagents("s1")[0].status, "detached");
});

test("evictDisconnected force-closes an idle environment whose socket still reports connected", () => {
  const h = makeHarness();
  h.connect("env-1");
  h.gateway.spawnSubagent("s1", { name: "Worker" });
  assert.equal(h.gateway.listEnvironments("s1").length, 1);

  // A half-open socket: still "connected", but no packet/heartbeat for ages.
  const environments = (
    h.gateway as unknown as {
      environments: Map<
        string,
        { socket: { connected: boolean }; lastSeenAt: number }
      >;
    }
  ).environments;
  const stale = environments.get("env-1");
  assert.ok(stale);
  assert.equal(stale.socket.connected, true);
  stale.lastSeenAt = Date.now() - 10 * 60_000;

  h.gateway.evictDisconnected();

  // Force-close fired `disconnect`, which dropped it through the normal path.
  assert.deepEqual(h.gateway.listEnvironments("s1"), []);
  assert.equal(h.gateway.listSubagents("s1")[0].status, "detached");
});

test("a selector-scoped host serves a session whose tags include its selector", async () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const tagged = await h.store.createSession({
    name: "P",
    tags: ["projectId:abc"],
  });
  const untagged = await h.store.createSession({ name: "Q" });
  const host = h.connect("env-sel", {
    token: mintSelector(scoped, "env-sel", "projectId:abc", "alice@x"),
  });
  host.send(RemoteEnvEvents.ToolsRegister, { tools: [ECHO_TOOL] });

  const listed = h.gateway.listEnvironments(tagged.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].environmentId, "env-sel");
  assert.equal(listed[0].selector, "projectId:abc");
  assert.equal(listed[0].scoped, true);
  assert.deepEqual(h.gateway.listEnvironments(untagged.id), []);

  const pending = h.gateway.callTool(tagged.id, "prime", "echo", {}, "alice@x");
  assert.equal(toolCalls(host.sent).length, 1, "the owner's prompt reaches it");
  toolCalls(host.sent)[0].ack?.(null, { ok: true, result: "ok" });
  await pending;
});

test("a user-scoped host serves every session its owner prompts in", async () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const s1 = await h.store.createSession({ name: "A" });
  const s2 = await h.store.createSession({ name: "B" });
  const host = h.connect("env-u", {
    token: mintUser(scoped, "env-u", "alice@x"),
  });
  host.send(RemoteEnvEvents.ToolsRegister, { tools: [ECHO_TOOL] });

  for (const session of [s1, s2]) {
    const pending = h.gateway.callTool(
      session.id,
      "prime",
      "echo",
      {},
      "alice@x",
    );
    toolCalls(host.sent).at(-1)?.ack?.(null, { ok: true, result: "ok" });
    await pending;
  }
  assert.equal(toolCalls(host.sent).length, 2, "both sessions routed to it");
});

test("a selector host owned by one person never serves another's prompt", async () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const tagged = await h.store.createSession({
    name: "Shared",
    tags: ["projectId:abc"],
  });
  const bob = h.connect("env-b", {
    token: mintSelector(scoped, "env-b", "projectId:abc", "bob@x"),
  });
  bob.send(RemoteEnvEvents.ToolsRegister, { tools: [ECHO_TOOL] });

  // Bob's host is eligible for the session, but Alice's prompt must fail closed
  // rather than land in it — and never fall back to a dev host.
  await assert.rejects(
    () => h.gateway.callTool(tagged.id, "prime", "echo", {}, "alice@x"),
    /prompting user's host is not connected/,
  );
  assert.equal(toolCalls(bob.sent).length, 0);
});

test("a selector host and a session-scoped host coexist, newest name wins", async () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const session = await h.store.createSession({
    name: "P",
    tags: ["projectId:abc"],
  });
  const selectorHost = h.connect("env-sel", {
    token: mintSelector(scoped, "env-sel", "projectId:abc", "alice@x"),
  });
  const sessionHost = h.connect("env-sess", {
    token: mintScoped(scoped, "env-sess", session.id, "alice@x"),
  });
  selectorHost.send(RemoteEnvEvents.ToolsRegister, { tools: [ECHO_TOOL] });
  sessionHost.send(RemoteEnvEvents.ToolsRegister, {
    sessionId: session.id,
    tools: [ECHO_TOOL],
  });

  const pending = h.gateway.callTool(
    session.id,
    "prime",
    "echo",
    {},
    "alice@x",
  );
  assert.equal(toolCalls(sessionHost.sent).length, 1, "the newer host wins");
  assert.equal(toolCalls(selectorHost.sent).length, 0);
  toolCalls(sessionHost.sent)[0].ack?.(null, { ok: true, result: "ok" });
  await pending;
});

test("a user-scoped host reads a restricted session its owner holds", async () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const session = await h.store.createSession({
    name: "Owned",
    user: owner("alice@x"),
  });
  await h.store.updateSession(session.id, { accessPolicy: "restricted" });
  await seedMessage(h.store, session.id, "secret");
  const host = h.connect("env-u", {
    token: mintUser(scoped, "env-u", "alice@x"),
  });

  const response = await readRoom(host, session.id);

  assert.deepEqual(
    response.messages.map((m) => m.content),
    ["secret"],
  );
});

test("a user-scoped host cannot read a restricted session it has no access to", async () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const session = await h.store.createSession({
    name: "Private",
    user: owner("alice@x"),
  });
  await h.store.updateSession(session.id, { accessPolicy: "restricted" });
  await seedMessage(h.store, session.id, "secret");
  const intruder = h.connect("env-x", {
    token: mintUser(scoped, "env-x", "mallory@x"),
  });

  const response = await readRoom(intruder, session.id);

  assert.deepEqual(response.messages, [], "the transcript is not disclosed");
});

test("a user-scoped host reads a restricted session it holds a membership in", async () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  h.gateway.useSessionAuthorization(async () => true);
  const session = await h.store.createSession({
    name: "Shared",
    user: owner("alice@x"),
  });
  await h.store.updateSession(session.id, { accessPolicy: "restricted" });
  await seedMessage(h.store, session.id, "shared");
  const member = h.connect("env-m", {
    token: mintUser(scoped, "env-m", "bob@x"),
  });

  const response = await readRoom(member, session.id);

  assert.deepEqual(
    response.messages.map((m) => m.content),
    ["shared"],
  );
});

test("a user-scoped host reads any open session", async () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const session = await h.store.createSession({ name: "Open" });
  await seedMessage(h.store, session.id, "public");
  const host = h.connect("env-u", {
    token: mintUser(scoped, "env-u", "anyone@x"),
  });

  const response = await readRoom(host, session.id);

  assert.deepEqual(
    response.messages.map((m) => m.content),
    ["public"],
  );
});

test("a selector-scoped host reads a session its selector tags, not others", async () => {
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const h = makeHarness({ scoped });
  const tagged = await h.store.createSession({
    name: "P",
    tags: ["projectId:abc"],
  });
  const untagged = await h.store.createSession({ name: "Q" });
  await seedMessage(h.store, tagged.id, "in-project");
  await seedMessage(h.store, untagged.id, "elsewhere");
  const host = h.connect("env-sel", {
    token: mintSelector(scoped, "env-sel", "projectId:abc", "alice@x"),
  });

  assert.deepEqual(
    (await readRoom(host, tagged.id)).messages.map((m) => m.content),
    ["in-project"],
  );
  assert.deepEqual((await readRoom(host, untagged.id)).messages, []);
});

test("a host cannot report events for a sub-agent another host owns", () => {
  const h = makeHarness();
  h.connect("env-1");
  const { info } = h.gateway.spawnSubagent("s1", { name: "Worker" });
  const intruder = h.connect("env-2");

  intruder.send(RemoteEnvEvents.AgentEvent, {
    sessionId: "s1",
    agentId: info.id,
    event: { type: "start", messageId: "m1" },
  } satisfies RemoteAgentEventPayload);

  assert.deepEqual(h.agentEvents, [], "the spoofed event is dropped");
});
