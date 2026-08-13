import assert from "node:assert/strict";
import { test } from "node:test";

import { connectorFor, type SubagentInfo } from "@tangent/shared/contracts.ts";
import type { Server } from "socket.io";

import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import type { DeliveryRequest } from "../connectors/types.ts";
import { ConversationRouter } from "../conversation/conversationRouter.ts";
import { MembershipRegistry } from "../conversation/membershipRegistry.ts";
import { InMemoryMembershipStore } from "../store/inMemoryMembershipStore.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import { RelayRegistry } from "./relayRegistry.ts";
import { createRelayReport } from "./relayReport.ts";

/**
 * A report over a real router and membership registry, with the roster faked at
 * the connector boundary — so where a peer's words land is decided by the same
 * derivation delivery uses.
 */
function makeReport(roster: SubagentInfo[]) {
  const sessions = new InMemorySessionStore();
  const memberships = new MembershipRegistry(
    sessions,
    new InMemoryMembershipStore(),
    () => true,
  );
  const delivered: DeliveryRequest[] = [];

  const io = {
    to: () => ({ emit: () => {} }),
  } as unknown as Server;

  const connectors = {
    list: () => roster,
    resolve: () => ({
      deliver: (request: DeliveryRequest) => {
        delivered.push(request);
        return { delivered: true };
      },
    }),
  } as unknown as ConnectorRegistry;

  const conversations = new ConversationRouter(io, sessions, memberships);
  conversations.useConnectors(connectors);
  const relay = new RelayRegistry();
  return {
    relay,
    sessions,
    delivered,
    report: createRelayReport(connectors, conversations, sessions),
  };
}

function workerRow(id: string, name: string): SubagentInfo {
  return {
    id,
    conversationId: id,
    name,
    status: "active",
    connector: connectorFor("external-inbound"),
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

test("a participant's channel posts in its own thread, addressed to Prime", async () => {
  const h = makeReport([workerRow("ext-1", "Explorer")]);
  await h.sessions.recordAgent("s1", {
    id: "ext-1",
    role: "subagent",
    name: "Explorer",
    status: "active",
    autoRelayToPrime: true,
    homeConversationId: "ext-1",
    connector: connectorFor("external-inbound"),
  });
  const { channelId } = h.relay.open({
    sessionId: "s1",
    label: "Explorer",
    participantId: "ext-1",
  });

  await h.report(h.relay.get(channelId)!, "found the zone");

  const [message] = await h.sessions.getMessages("s1");
  assert.equal(message.conversationId, "ext-1");
  assert.equal(message.author.id, "ext-1");
  assert.equal(message.author.name, "Explorer");
  assert.equal(message.content, "found the zone", "its own words, unwrapped");
  assert.deepEqual(message.mentions, ["prime"]);
  assert.deepEqual(
    h.delivered.map((request) => request.participantId),
    ["prime"],
    "and Prime woke because it was mentioned",
  );
});

test("a channel nobody owns still delivers to Prime with the peer's label", async () => {
  const h = makeReport([]);
  const { channelId } = h.relay.open({ sessionId: "s1", label: "explorer" });

  await h.report(h.relay.get(channelId)!, "found the zone");

  assert.equal(h.delivered.length, 1);
  assert.equal(h.delivered[0].participantId, "prime");
  assert.match(h.delivered[0].text, /explorer/);
  assert.match(h.delivered[0].text, /found the zone/);
  assert.deepEqual(
    await h.sessions.getMessages("s1"),
    [],
    "nothing is posted for a peer with no standing anywhere",
  );
});

test("a bound channel whose tab has gone falls back rather than losing the text", async () => {
  const h = makeReport([]);
  const { channelId } = h.relay.open({
    sessionId: "s1",
    label: "explorer",
    participantId: "ext-gone",
  });

  await h.report(h.relay.get(channelId)!, "last word");

  assert.equal(h.delivered.length, 1);
  assert.match(h.delivered[0].text, /last word/);
});
