import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type ConnectorDescriptor,
  connectorFields,
  connectorFor,
  type SubagentInfo,
} from "@tangent/shared/contracts.ts";

import { ExternalSubagentGateway } from "../external/externalSubagentGateway.ts";
import type { PiAgentManager } from "../pi/piAgentManager.ts";
import type { ConversationEventSink } from "../pi/types.ts";
import type { RemoteEnvironmentGateway } from "../remote/remoteEnvironmentGateway.ts";
import { RunRegistry } from "../runs/runRegistry.ts";
import { InMemoryRunStore } from "../store/inMemoryRunStore.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import type { SessionAgent } from "../store/sessionStore.ts";
import { createConnectorRegistry } from "./connectorRegistry.ts";

/** A message a fake gateway was asked to deliver. */
interface Delivery {
  sessionId: string;
  agentId: string;
  text: string;
}

/** A message the server surfaced into a conversation. */
interface Surfaced {
  conversationId: string;
  author: string;
  content: string;
}

function rosterEntry(
  id: string,
  kind: "pi-stdio" | "remote-env",
): SubagentInfo {
  return {
    id,
    name: id,
    status: "active",
    ...connectorFields(kind),
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** A persisted roster row, as a revive reads one. */
function agentRow(
  id: string,
  connector: ConnectorDescriptor,
  overrides: Partial<SessionAgent> = {},
): SessionAgent {
  return {
    id,
    sessionId: "s1",
    role: "subagent",
    name: id,
    status: "detached",
    connector,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A fake Pi manager recording what it was asked to do with `local-1`. */
function fakePi() {
  const deliveries: Delivery[] = [];
  const kills: string[] = [];
  const aborts: string[] = [];
  const revives: string[] = [];
  const pi = {
    hasAgent: (_sessionId: string, agentId: string) => agentId === "local-1",
    listSubagents: () => [rosterEntry("local-1", "pi-stdio")],
    sendToAgent: ({ sessionId, agentId, text }: Delivery) =>
      deliveries.push({ sessionId, agentId, text }),
    killAgent: (_sessionId: string, agentId: string) => kills.push(agentId),
    // Mirrors the real manager: only a busy agent has anything to cancel.
    abort: (_sessionId: string, agentId: string) => {
      aborts.push(agentId);
      return agentId === "local-1";
    },
    reviveSubagent: (_sessionId: string, agent: SessionAgent) =>
      revives.push(agent.id),
  } as unknown as PiAgentManager;
  return { pi, deliveries, kills, aborts, revives };
}

/** A fake remote gateway recording what it was asked to do with `remote-1`. */
function fakeRemote() {
  const deliveries: Delivery[] = [];
  const reattaches: string[] = [];
  const gateway = {
    hasAgent: (_sessionId: string, agentId: string) => agentId === "remote-1",
    listSubagents: () => [rosterEntry("remote-1", "remote-env")],
    sendToAgent: ({ sessionId, agentId, text }: Delivery) => {
      deliveries.push({ sessionId, agentId, text });
      return true;
    },
    killAgent: () => {},
    reattach: (_sessionId: string, agent: SessionAgent) =>
      reattaches.push(agent.id),
  } as unknown as RemoteEnvironmentGateway;
  return { gateway, deliveries, reattaches };
}

/**
 * A registry over the real external gateway plus fakes for the local and remote
 * transports, so a delivery can be traced to exactly one of them.
 */
function makeHarness() {
  const surfaced: Surfaced[] = [];
  const handlers: ConversationEventSink = {
    onAgentEvent: () => {},
    onSubagentUpdate: () => {},
    onAgentMessage: ({ conversationId, author, content }) =>
      surfaced.push({ conversationId, author: author.name, content }),
    onSessionStatus: () => {},
  };

  const local = fakePi();
  const remote = fakeRemote();
  const externalGateway = new ExternalSubagentGateway(
    handlers,
    new RunRegistry(new InMemoryRunStore()),
    new InMemorySessionStore(),
  );
  const connectors = createConnectorRegistry(
    local.pi,
    remote.gateway,
    externalGateway,
    handlers,
  );

  return {
    connectors,
    externalGateway,
    surfaced,
    piDeliveries: local.deliveries,
    piKills: local.kills,
    piAborts: local.aborts,
    piRevives: local.revives,
    remoteDeliveries: remote.deliveries,
    remoteReattaches: remote.reattaches,
  };
}

test("resolution is total: an unheld participant gets a refusing connector", () => {
  const h = makeHarness();

  const connector = h.connectors.resolve("s1", "ghost");

  assert.equal(connector.descriptor.kind, "unresolved");
  assert.equal(connector.acceptsDelivery, false);
});

test("a message to an unknown participant is refused in its own conversation", () => {
  const h = makeHarness();

  const result = h.connectors.resolve("s1", "ghost").deliver({
    sessionId: "s1",
    participantId: "ghost",
    text: "are you there",
  });

  assert.equal(result.delivered, false);
  // The failure belongs to the conversation it was addressed to, not Prime's.
  assert.equal(h.surfaced.at(-1)?.conversationId, "ghost");
  assert.equal(h.surfaced.at(-1)?.author, "System");
  assert.deepEqual(h.piDeliveries, []);
});

test("a message aimed at an external participant never reaches the local agents", () => {
  const h = makeHarness();
  const { id } = h.externalGateway.register("s1", { name: "worker" });

  const result = h.connectors.resolve("s1", id).deliver({
    sessionId: "s1",
    participantId: id,
    text: "do the thing",
  });

  assert.equal(result.delivered, false);
  assert.equal(h.surfaced.at(-1)?.conversationId, id);
  assert.deepEqual(h.piDeliveries, []);
});

test("a message aimed at a remote participant reaches the remote gateway", () => {
  const h = makeHarness();

  const result = h.connectors.resolve("s1", "remote-1").deliver({
    sessionId: "s1",
    participantId: "remote-1",
    text: "do the thing",
  });

  assert.equal(result.delivered, true);
  assert.deepEqual(h.remoteDeliveries, [
    { sessionId: "s1", agentId: "remote-1", text: "do the thing" },
  ]);
  assert.deepEqual(h.piDeliveries, []);
});

test("a message aimed at a local participant reaches the Pi manager", () => {
  const h = makeHarness();

  const result = h.connectors.resolve("s1", "local-1").deliver({
    sessionId: "s1",
    participantId: "local-1",
    text: "do the thing",
  });

  assert.equal(result.delivered, true);
  assert.deepEqual(h.piDeliveries, [
    { sessionId: "s1", agentId: "local-1", text: "do the thing" },
  ]);
});

test("cancelling a local participant's run reaches the Pi manager", () => {
  const h = makeHarness();

  const result = h.connectors.cancelRun({
    sessionId: "s1",
    participantId: "local-1",
  });

  assert.equal(result.cancelled, true);
  assert.deepEqual(h.piAborts, ["local-1"]);
});

test("a transport with no cancel protocol refuses, and says why", () => {
  const h = makeHarness();
  const external = h.externalGateway.register("s1", { name: "worker" });

  const remote = h.connectors.cancelRun({
    sessionId: "s1",
    participantId: "remote-1",
  });
  const ext = h.connectors.cancelRun({
    sessionId: "s1",
    participantId: external.id,
  });
  const unknown = h.connectors.cancelRun({
    sessionId: "s1",
    participantId: "ghost",
  });

  for (const result of [remote, ext, unknown]) {
    assert.equal(result.cancelled, false);
    assert.ok(result.reason);
  }
  // A refused cancellation stays out of the transcript, unlike a refused
  // delivery: nothing was said, so nothing needs answering.
  assert.deepEqual(h.surfaced, []);
  assert.deepEqual(h.piAborts, []);
});

test("killing an external participant reaches its gateway", () => {
  const h = makeHarness();
  const { id } = h.externalGateway.register("s1", { name: "worker" });

  h.connectors.resolve("s1", id).kill("s1", id, true);

  assert.equal(h.externalGateway.hasAgent("s1", id), false);
  assert.deepEqual(h.piKills, []);
});

test("list walks every connector's roster", () => {
  const h = makeHarness();
  const { id } = h.externalGateway.register("s1", { name: "worker" });

  assert.deepEqual(
    h.connectors.list("s1").map((s) => s.id),
    ["local-1", "remote-1", id],
  );
});

test("revive routes each persisted row to the connector that recorded it", () => {
  const h = makeHarness();

  h.connectors.revive("s1", [
    agentRow("local-1", connectorFor("pi-stdio")),
    agentRow("remote-1", connectorFor("remote-env", "env-1")),
    agentRow("ext-1", connectorFor("external-inbound")),
  ]);

  assert.deepEqual(h.piRevives, ["local-1"]);
  assert.deepEqual(h.remoteReattaches, ["remote-1"]);
  // The external gateway is real, so its reattach is visible in the roster —
  // restored as `detached`, since nothing here creates the far side.
  assert.deepEqual(h.externalGateway.listSubagents("s1"), [
    {
      id: "ext-1",
      name: "ext-1",
      status: "detached",
      ...connectorFields("external-inbound"),
      template: undefined,
      model: undefined,
      thinkingDepth: undefined,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
});

test("revive skips Prime, terminal rows and attached participants", () => {
  const h = makeHarness();

  h.connectors.revive("s1", [
    agentRow("prime", connectorFor("pi-stdio"), { role: "prime" }),
    agentRow("killed-1", connectorFor("pi-stdio"), { status: "killed" }),
    // An attached connector's far end exists independently of Tangent, so it
    // waits to be reattached rather than being brought back from a row.
    agentRow("attached-1", {
      kind: "pi-stdio",
      lifecycle: "attached",
      spawnAuthority: "server",
    }),
  ]);

  assert.deepEqual(h.piRevives, []);
});

test("only connectors the spawn API may act on are spawners", () => {
  const h = makeHarness();

  assert.ok(h.connectors.spawner("pi-stdio"));
  assert.ok(h.connectors.spawner("remote-env"));
  assert.equal(h.connectors.spawner("external-inbound"), undefined);
  assert.equal(h.connectors.spawner("a2a"), undefined);
});
