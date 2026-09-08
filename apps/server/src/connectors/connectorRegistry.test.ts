import assert from "node:assert/strict";
import { test } from "node:test";

import {
  capabilitiesForRole,
  type ConnectorDescriptor,
  connectorFor,
  type SubagentInfo,
} from "@tangent/shared/contracts.ts";

import { A2aPeerGateway } from "../a2a/a2aPeerGateway.ts";
import { ExternalSubagentGateway } from "../external/externalSubagentGateway.ts";
import { RelayRegistry } from "../mcp/relayRegistry.ts";
import type { PiAgentManager } from "../pi/piAgentManager.ts";
import type { ConversationEventSink } from "../pi/types.ts";
import type { RemoteEnvironmentGateway } from "../remote/remoteEnvironmentGateway.ts";
import { RunRegistry } from "../runs/runRegistry.ts";
import { InMemoryRunStore } from "../store/inMemoryRunStore.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import type { SessionAgent } from "../store/sessionStore.ts";
import { createConnectorRegistry } from "./connectorRegistry.ts";
import { PeerBearerCredential } from "./credentials.ts";

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
    conversationId: id,
    name: id,
    status: "active",
    connector: connectorFor(kind),
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
    capabilities: capabilitiesForRole(overrides.role ?? "subagent"),
    status: "detached",
    connector,
    homeConversationId: id,
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
  const runs = new RunRegistry(new InMemoryRunStore());
  const externalGateway = new ExternalSubagentGateway(
    handlers,
    runs,
    new InMemorySessionStore(),
    new RelayRegistry(),
  );
  // Real, like the external gateway, with only its discovery replaced: a peer
  // that answers nothing still holds a tab, which is all resolution needs.
  const a2aGateway = new A2aPeerGateway(
    handlers,
    runs,
    new InMemorySessionStore(),
    () => {},
    new PeerBearerCredential(""),
    async () => ({
      card: { name: "Weather" },
      async *send() {},
      async cancel() {},
    }),
  );
  const connectors = createConnectorRegistry(
    local.pi,
    remote.gateway,
    externalGateway,
    a2aGateway,
    handlers,
  );

  return {
    connectors,
    externalGateway,
    a2aGateway,
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

test("every connector's credential agrees with the scheme it publishes", async () => {
  const h = makeHarness();
  const { id } = h.externalGateway.register("s1", { name: "worker" });
  const peer = await h.a2aGateway.attach("s1", {
    endpointUrl: "https://agent.example.com",
  });

  // The descriptor names the scheme (it goes to clients); the credential holds
  // the secret (it does not). A connector whose two disagreed would be lying
  // about how its far end is authenticated.
  for (const participantId of ["local-1", "remote-1", id, peer.id, "ghost"]) {
    const connector = h.connectors.resolve("s1", participantId);
    assert.equal(
      connector.credential.scheme,
      connector.descriptor.credentialScheme,
      `${participantId} publishes a scheme its credential does not implement`,
    );
  }

  assert.equal(
    h.connectors.resolve("s1", "local-1").descriptor.credentialScheme,
    "inherited-token",
  );
  assert.equal(
    h.connectors.resolve("s1", peer.id).descriptor.credentialScheme,
    "peer-bearer",
  );
  assert.equal(
    h.connectors.resolve("s1", "ghost").credential.configured,
    false,
  );
});

test("a message aimed at an A2A peer reaches its gateway, not the local agents", async () => {
  const h = makeHarness();
  const peer = await h.a2aGateway.attach("s1", {
    endpointUrl: "https://agent.example.com",
  });

  const result = h.connectors.resolve("s1", peer.id).deliver({
    sessionId: "s1",
    participantId: peer.id,
    text: "do the thing",
  });

  assert.equal(result.delivered, true);
  assert.deepEqual(h.piDeliveries, []);
  assert.deepEqual(h.remoteDeliveries, []);
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

test("a message aimed at an external participant is queued for its driver", async () => {
  const h = makeHarness();
  const { id } = h.externalGateway.register("s1", { name: "worker" });

  const result = h.connectors.resolve("s1", id).deliver({
    sessionId: "s1",
    participantId: id,
    text: "do the thing",
  });

  assert.equal(result.delivered, true);
  assert.deepEqual(await h.externalGateway.takeDeliveries("s1", 5), [
    { agentId: id, text: "do the thing" },
  ]);
  assert.deepEqual(h.piDeliveries, [], "and never the local agent map");
});

test("a message aimed at a detached external participant is refused in its tab", () => {
  const h = makeHarness();
  const { id } = h.externalGateway.register("s1", { name: "worker" });
  h.externalGateway.setStatus("s1", id, "detached");

  const result = h.connectors.resolve("s1", id).deliver({
    sessionId: "s1",
    participantId: id,
    text: "do the thing",
  });

  // Nothing is driving that far side, so queuing the wake would promise a
  // delivery the transport cannot make.
  assert.equal(result.delivered, false);
  assert.equal(h.surfaced.at(-1)?.conversationId, id);
  assert.equal(h.surfaced.at(-1)?.author, "System");
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

test("list walks every connector's roster", async () => {
  const h = makeHarness();
  const { id } = h.externalGateway.register("s1", { name: "worker" });
  const peer = await h.a2aGateway.attach("s1", {
    endpointUrl: "https://agent.example.com",
  });

  assert.deepEqual(
    h.connectors.list("s1").map((s) => s.id),
    ["local-1", "remote-1", id, peer.id],
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
      conversationId: "ext-1",
      name: "ext-1",
      status: "detached",
      connector: connectorFor("external-inbound"),
      template: undefined,
      model: undefined,
      thinkingDepth: undefined,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
});

test("revive skips Prime and terminal rows", () => {
  const h = makeHarness();

  h.connectors.revive("s1", [
    agentRow("prime", connectorFor("pi-stdio"), { role: "prime" }),
    agentRow("killed-1", connectorFor("pi-stdio"), { status: "killed" }),
  ]);

  assert.deepEqual(h.piRevives, []);
});

test("an attached row is restored too: what a revive means is the connector's call", () => {
  const h = makeHarness();

  // Tangent is the client of an A2A service, so "wait to be reattached" would
  // mean "never". The tab comes back detached from the endpoint the row kept,
  // and the next delivery re-discovers the peer.
  h.connectors.revive("s1", [
    agentRow("peer-1", {
      ...connectorFor("a2a"),
      endpointUrl: "https://agent.example.com",
    }),
  ]);

  assert.deepEqual(h.a2aGateway.listSubagents("s1"), [
    {
      id: "peer-1",
      conversationId: "peer-1",
      name: "peer-1",
      status: "detached",
      connector: {
        ...connectorFor("a2a"),
        endpointUrl: "https://agent.example.com",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
});

test("only connectors the spawn API may act on are spawners", () => {
  const h = makeHarness();

  assert.ok(h.connectors.spawner("pi-stdio"));
  assert.ok(h.connectors.spawner("remote-env"));
  // Creating an external participant stays the bundle tool's act (`world_spawn`),
  // which is what `spawnAuthority: "bundle-tool"` means: reachable by message,
  // never spawnable through the spawn API.
  assert.equal(h.connectors.spawner("external-inbound"), undefined);
  assert.equal(h.connectors.spawner("a2a"), undefined);
});

test("every transport but the unresolved one can be delivered to", () => {
  const h = makeHarness();

  // Read when deriving a Membership: an external participant now declares that
  // messages reach it, so its reaction is derived like any other sub-agent's.
  assert.equal(h.connectors.acceptsDelivery("pi-stdio"), true);
  assert.equal(h.connectors.acceptsDelivery("remote-env"), true);
  assert.equal(h.connectors.acceptsDelivery("external-inbound"), true);
  assert.equal(h.connectors.acceptsDelivery("a2a"), true);
  assert.equal(h.connectors.acceptsDelivery("unresolved"), false);
});
