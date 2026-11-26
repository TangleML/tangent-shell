import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationEventSink } from "../pi/types.ts";
import type { RemoteEnvironmentGateway } from "../remote/remoteEnvironmentGateway.ts";
import { RemoteEnvConnector } from "./remoteEnvConnector.ts";
import type { DeliveryRequest } from "./types.ts";

/** A delivery the connector asked the gateway to send. */
interface Sent {
  agentId: string;
  text: string;
  audienceParticipantId?: string;
}

/** A message the connector surfaced into a conversation. */
interface Surfaced {
  conversationId: string;
  content: string;
}

/**
 * A gateway recording what the connector asked of it. `owner` is the email the
 * owner gate admits; any other audience is refused.
 */
function makeHarness(owner?: string) {
  const sends: Sent[] = [];
  const surfaced: Surfaced[] = [];

  const gateway = {
    hasAgent: () => true,
    listSubagents: () => [],
    canDirectSubagent: (
      _sessionId: string,
      _agentId: string,
      audienceParticipantId?: string,
    ) => !owner || !audienceParticipantId || audienceParticipantId === owner,
    sendToAgent: (options: Sent) => {
      sends.push(options);
      return true;
    },
  } as unknown as RemoteEnvironmentGateway;

  const handlers: ConversationEventSink = {
    onAgentEvent: () => {},
    onSubagentUpdate: () => {},
    onAgentMessage: ({ conversationId, content }) =>
      surfaced.push({ conversationId, content }),
    onSessionStatus: () => {},
  };

  const connector = new RemoteEnvConnector(gateway, handlers);
  return { connector, sends, surfaced };
}

function request(overrides: Partial<DeliveryRequest> = {}): DeliveryRequest {
  return {
    sessionId: "s1",
    participantId: "remote-1",
    text: "go",
    ...overrides,
  };
}

test("the owner's message reaches the sub-agent", () => {
  const h = makeHarness("alice@x");

  const result = h.connector.deliver(
    request({ audienceParticipantId: "alice@x" }),
  );

  assert.equal(result.delivered, true);
  assert.equal(h.sends.length, 1);
  assert.equal(h.surfaced.length, 0);
});

test("a non-owner's message is refused and never sent to the machine", () => {
  const h = makeHarness("alice@x");

  const result = h.connector.deliver(
    request({ audienceParticipantId: "bob@x", conversationId: "remote-1" }),
  );

  assert.equal(result.delivered, false);
  assert.equal(h.sends.length, 0, "nothing reaches the owner's machine");
  assert.equal(h.surfaced.length, 1);
  assert.equal(h.surfaced[0].conversationId, "remote-1");
  assert.match(h.surfaced[0].content, /Only the person who connected/);
});

test("an agent-originated delivery is not owner-gated", () => {
  const h = makeHarness("alice@x");

  const result = h.connector.deliver(request());

  assert.equal(result.delivered, true);
  assert.equal(h.sends.length, 1);
  assert.equal(h.surfaced.length, 0);
});
