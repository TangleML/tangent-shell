import assert from "node:assert/strict";
import { test } from "node:test";

import type { A2aPeerGateway } from "../a2a/a2aPeerGateway.ts";
import type { ConversationEventSink } from "../pi/types.ts";
import type { SessionAgent } from "../store/sessionStore.ts";
import { A2aConnector } from "./a2aConnector.ts";
import type { Connector } from "./types.ts";

/** A gateway recording what the connector asked of it. */
function makeHarness(holds = true) {
  const sends: string[] = [];
  const sendInputs: Array<{ text: string; conversationId?: string }> = [];
  const cancels: string[] = [];
  const detaches: Array<{ agentId: string; completed: boolean }> = [];
  const reattaches: string[] = [];
  const surfaced: Array<{ conversationId: string; content: string }> = [];

  const gateway = {
    hasAgent: () => holds,
    listSubagents: () => [],
    send: (input: { text: string; conversationId?: string }) => {
      sends.push(input.text);
      sendInputs.push(input);
      return holds;
    },
    cancel: (_sessionId: string, agentId: string) => {
      cancels.push(agentId);
      return holds;
    },
    detach: (_sessionId: string, agentId: string, completed: boolean) =>
      detaches.push({ agentId, completed }),
    reattach: (_sessionId: string, agent: SessionAgent) =>
      reattaches.push(agent.id),
  } as unknown as A2aPeerGateway;

  const handlers: ConversationEventSink = {
    onAgentEvent: () => {},
    onSubagentUpdate: () => {},
    onAgentMessage: ({ conversationId, content }) =>
      surfaced.push({ conversationId, content }),
    onSessionStatus: () => {},
  };

  // Held as the interface, so a test sees the connector the registry sees —
  // including the `spawn` this one deliberately does not implement.
  const connector: Connector = new A2aConnector(gateway, handlers);

  return {
    connector,
    sends,
    sendInputs,
    cancels,
    detaches,
    reattaches,
    surfaced,
  };
}

/** A persisted roster row, as a revive reads one. */
function agentRow(): SessionAgent {
  return {
    id: "peer-1",
    sessionId: "s1",
    role: "subagent",
    name: "Weather",
    capabilities: [],
    status: "detached",
    connector: {
      kind: "a2a",
      lifecycle: "attached",
      spawnAuthority: "none",
      credentialScheme: "peer-bearer",
      endpointUrl: "https://agent.example.com",
    },
    homeConversationId: "peer-1",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

test("the connector cannot spawn: an A2A agent is discovered, not created", () => {
  const h = makeHarness();

  // Absent rather than refusing at runtime, which is what `spawnAuthority:
  // "none"` means for a connector whose far end exists without us.
  assert.equal(h.connector.spawn, undefined);
  assert.equal(h.connector.descriptor.spawnAuthority, "none");
  assert.equal(h.connector.descriptor.lifecycle, "attached");
});

test("the published scheme is the one its credential implements", () => {
  const h = makeHarness();

  assert.equal(h.connector.descriptor.credentialScheme, "peer-bearer");
  assert.equal(h.connector.credential.scheme, "peer-bearer");
});

test("delivery is accepted synchronously and handed to the gateway", () => {
  const h = makeHarness();

  const result = h.connector.deliver({
    sessionId: "s1",
    participantId: "peer-1",
    text: "do the thing",
  });

  assert.deepEqual(result, { delivered: true });
  assert.deepEqual(h.sends, ["do the thing"]);
  // Nothing is said in the thread: the reply is what the peer will say there.
  assert.deepEqual(h.surfaced, []);
});

test("delivery forwards the addressing conversation, so the peer replies there", () => {
  const h = makeHarness();

  h.connector.deliver({
    sessionId: "s1",
    participantId: "peer-1",
    text: "in the room",
    conversationId: "room-1",
  });

  // A peer that is a member of a shared room answers in it, not in its private
  // thread — the gateway needs the Conversation the delivery came through.
  assert.equal(h.sendInputs.at(-1)?.conversationId, "room-1");
});

test("a delivery to a peer no longer attached is refused in its own thread", () => {
  const h = makeHarness(false);

  const result = h.connector.deliver({
    sessionId: "s1",
    participantId: "peer-1",
    text: "are you there",
  });

  assert.equal(result.delivered, false);
  assert.equal(h.surfaced.at(-1)?.conversationId, "peer-1");
  assert.match(h.surfaced.at(-1)?.content ?? "", /no longer attached/);
});

test("cancelling reaches the gateway, and says why when there is nothing to stop", () => {
  const running = makeHarness();
  const idle = makeHarness(false);

  assert.deepEqual(
    running.connector.cancelRun({ sessionId: "s1", participantId: "peer-1" }),
    { cancelled: true },
  );
  assert.deepEqual(running.cancels, ["peer-1"]);

  const refused = idle.connector.cancelRun({
    sessionId: "s1",
    participantId: "peer-1",
  });
  assert.equal(refused.cancelled, false);
  assert.ok(refused.reason);
});

test("kill ends the attachment rather than the agent", () => {
  const h = makeHarness();

  h.connector.kill("s1", "peer-1", true);

  assert.deepEqual(h.detaches, [{ agentId: "peer-1", completed: true }]);
});

test("revive restores the tab from the row, since nobody will reattach it", () => {
  const h = makeHarness();

  h.connector.revive("s1", agentRow());

  assert.deepEqual(h.reattaches, ["peer-1"]);
});
