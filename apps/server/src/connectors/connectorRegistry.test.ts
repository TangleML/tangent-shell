import assert from "node:assert/strict";
import { test } from "node:test";

import {
  connectorFields,
  type SubagentInfo,
} from "@tangent/shared/contracts.ts";

import { ExternalSubagentGateway } from "../external/externalSubagentGateway.ts";
import type { PiAgentManager } from "../pi/piAgentManager.ts";
import type { PiAgentHandlers } from "../pi/types.ts";
import type { RemoteEnvironmentGateway } from "../remote/remoteEnvironmentGateway.ts";
import { RunRegistry } from "../runs/runRegistry.ts";
import { InMemoryRunStore } from "../store/inMemoryRunStore.ts";
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

/**
 * A registry over the real external gateway plus fakes for the local and remote
 * transports, so a delivery can be traced to exactly one of them.
 */
function makeHarness() {
  const surfaced: Surfaced[] = [];
  const handlers: PiAgentHandlers = {
    onAgentEvent: () => {},
    onSubagentUpdate: () => {},
    onAgentMessage: (_sessionId, conversationId, author, content) =>
      surfaced.push({ conversationId, author: author.name, content }),
    onSessionStatus: () => {},
  };

  const piDeliveries: Delivery[] = [];
  const piKills: string[] = [];
  const piAborts: string[] = [];
  const pi = {
    hasAgent: (_sessionId: string, agentId: string) => agentId === "local-1",
    listSubagents: () => [rosterEntry("local-1", "pi-stdio")],
    sendToAgent: (sessionId: string, agentId: string, text: string) =>
      piDeliveries.push({ sessionId, agentId, text }),
    killAgent: (_sessionId: string, agentId: string) => piKills.push(agentId),
    // Mirrors the real manager: only a busy agent has anything to cancel.
    abort: (_sessionId: string, agentId: string) => {
      piAborts.push(agentId);
      return agentId === "local-1";
    },
  } as unknown as PiAgentManager;

  const remoteDeliveries: Delivery[] = [];
  const remoteGateway = {
    hasAgent: (_sessionId: string, agentId: string) => agentId === "remote-1",
    listSubagents: () => [rosterEntry("remote-1", "remote-env")],
    sendToAgent: (sessionId: string, agentId: string, text: string) =>
      remoteDeliveries.push({ sessionId, agentId, text }),
    killAgent: () => {},
  } as unknown as RemoteEnvironmentGateway;

  const externalGateway = new ExternalSubagentGateway(
    handlers,
    new RunRegistry(new InMemoryRunStore()),
  );
  const connectors = createConnectorRegistry(
    pi,
    remoteGateway,
    externalGateway,
    handlers,
  );

  return {
    connectors,
    externalGateway,
    surfaced,
    piDeliveries,
    piKills,
    piAborts,
    remoteDeliveries,
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

test("only connectors the spawn API may act on are spawners", () => {
  const h = makeHarness();

  assert.ok(h.connectors.spawner("pi-stdio"));
  assert.ok(h.connectors.spawner("remote-env"));
  assert.equal(h.connectors.spawner("external-inbound"), undefined);
  assert.equal(h.connectors.spawner("a2a"), undefined);
});
