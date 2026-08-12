import assert from "node:assert/strict";
import { test } from "node:test";

import { connectorFor, type SubagentInfo } from "@tangent/shared/contracts.ts";
import {
  type RemoteAgentEventPayload,
  RemoteEnvEvents,
} from "@tangent/shared/remoteSubagent.ts";
import type { Server as SocketIOServer, Socket } from "socket.io";

import type { ConversationEventSink } from "../pi/types.ts";
import { RunRegistry } from "../runs/runRegistry.ts";
import { InMemoryRunStore } from "../store/inMemoryRunStore.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import { RemoteEnvironmentGateway } from "./remoteEnvironmentGateway.ts";

/** Lets a fire-and-forget roster replay settle before asserting on it. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * A gateway wired to a fake namespace, plus a `connect` that registers an
 * environment by driving the captured connection handler (bypassing the token
 * middleware, which is not what these tests are about). The returned handle
 * drives the environment's inbound events and its disconnect.
 */
function makeHarness() {
  let onConnection: ((socket: Socket) => void) | undefined;
  const namespace = {
    use: () => {},
    on: (event: string, handler: (socket: Socket) => void) => {
      if (event === "connection") onConnection = handler;
    },
  };

  const rosterUpdates: SubagentInfo[] = [];
  const handlers: ConversationEventSink = {
    onAgentEvent: () => {},
    onSubagentUpdate: (_sessionId, info) => rosterUpdates.push(info),
    onAgentMessage: () => {},
    onSessionStatus: () => {},
  };
  const store = new InMemorySessionStore();
  const runStore = new InMemoryRunStore();
  const runs = new RunRegistry(runStore);

  const gateway = new RemoteEnvironmentGateway(
    { of: () => namespace } as unknown as SocketIOServer,
    handlers,
    store,
    runs,
  );

  const connect = (environmentId: string) => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const sent: Array<{ event: string; payload: unknown }> = [];
    const socket = {
      handshake: { auth: { environmentId } },
      on: (event: string, handler: (payload: unknown) => void) =>
        listeners.set(event, handler),
      emit: (event: string, payload: unknown) => sent.push({ event, payload }),
    } as unknown as Socket;
    onConnection?.(socket);
    return {
      sent,
      send: (event: string, payload: unknown) =>
        listeners.get(event)?.(payload),
      disconnect: () => listeners.get("disconnect")?.(undefined),
    };
  };

  return { gateway, connect, store, runs, runStore, rosterUpdates };
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

test("the remote roster describes its connector and environment", () => {
  const h = makeHarness();
  h.connect("env-1");

  const { info } = h.gateway.spawnSubagent("s1", { name: "Worker" });

  const expected = {
    kind: "remote-env",
    lifecycle: "owned",
    spawnAuthority: "remote-env",
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
