import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type ChatAuthor,
  type ChatMessage,
  connectorFor,
  PI_AGENT,
} from "@tangent/shared/contracts.ts";
import type { Server } from "socket.io";

import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import type { DeliveryRequest } from "../connectors/types.ts";
import { InMemoryMembershipStore } from "../store/inMemoryMembershipStore.ts";
import { InMemoryResourceStore } from "../store/inMemoryResourceStore.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import type { Membership } from "../store/membershipStore.ts";
import { ConversationRouter, deliveryText } from "./conversationRouter.ts";
import { MembershipRegistry } from "./membershipRegistry.ts";
import { ResourceCatalog } from "./resourceCatalog.ts";

const WORKER: ChatAuthor = {
  id: "sub-1",
  kind: "agent",
  name: "Worker",
  agentRole: "subagent",
};

/**
 * A router over in-memory stores and a real membership registry, so
 * authorization is answered by the same derivation delivery uses. `delivered`
 * is what "who was woken" is measured by and `emitted` what the room saw.
 */
function makeRouter() {
  const sessions = new InMemorySessionStore();
  const memberships = new MembershipRegistry(
    sessions,
    new InMemoryMembershipStore(),
    () => true,
  );
  const emitted: unknown[] = [];
  const delivered: DeliveryRequest[] = [];

  const io = {
    to: () => ({
      emit: (_event: string, payload: unknown) => emitted.push(payload),
    }),
  } as unknown as Server;

  const connectors = {
    resolve: () => ({
      deliver: (request: DeliveryRequest) => {
        delivered.push(request);
        return { delivered: true };
      },
    }),
  } as unknown as ConnectorRegistry;

  const resourceStore = new InMemoryResourceStore();
  const router = new ConversationRouter(
    io,
    sessions,
    memberships,
    new ResourceCatalog(resourceStore),
  );
  router.useConnectors(connectors);
  return { router, sessions, emitted, delivered, resourceStore };
}

/** A persisted sub-agent, so its Conversation's memberships derive from a row. */
async function withWorker(sessions: InMemorySessionStore, id = "sub-1") {
  await sessions.recordAgent("s1", {
    id,
    role: "subagent",
    name: "Worker",
    status: "active",
    autoRelayToPrime: true,
    connector: connectorFor("pi-stdio"),
  });
}

test("an ordinary post records provenance derived from its author", async () => {
  const h = makeRouter();
  await withWorker(h.sessions);

  const { message } = await h.router.post({
    sessionId: "s1",
    conversationId: "sub-1",
    author: WORKER,
    content: "done",
  });

  assert.deepEqual(message.source, { kind: "agent" });
});

test("a cross-conversation post is recorded as having arrived from elsewhere", async () => {
  const h = makeRouter();
  await withWorker(h.sessions);

  const { message, woke } = await h.router.postToConversation({
    sessionId: "s1",
    conversationId: "sub-1",
    fromConversation: "prime",
    author: PI_AGENT,
    content: "look into the failing build",
    mentions: ["sub-1"],
    ingress: "tool",
  });

  assert.deepEqual(message?.source, {
    kind: "relay",
    from: "prime",
    fromConversation: "prime",
  });
  assert.deepEqual(woke, ["sub-1"], "the addressed participant still runs");
  assert.equal(h.delivered.length, 1);
  assert.equal(h.emitted.length, 1, "and the room sees it as one message");

  const persisted = await h.sessions.getMessages("s1");
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].source.fromConversation, "prime");
});

test("a participant with no membership there posts nothing at all", async () => {
  const h = makeRouter();
  await withWorker(h.sessions);
  await withWorker(h.sessions, "sub-2");

  // sub-2's conversation holds sub-2 and the orchestrator; a peer worker is not
  // a member of it, so the post is refused rather than delivered.
  const { message, woke, refused } = await h.router.postToConversation({
    sessionId: "s1",
    conversationId: "sub-2",
    fromConversation: "sub-1",
    author: WORKER,
    content: "take this over",
    mentions: ["sub-2"],
    ingress: "tool",
  });

  assert.equal(message, undefined);
  assert.deepEqual(woke, []);
  assert.deepEqual(
    refused.map((entry) => entry.participantId),
    ["sub-1"],
    "the refusal is about the author, not the recipient",
  );
  assert.match(refused[0].reason, /isn't a member of that conversation/);
  assert.deepEqual(await h.sessions.getMessages("s1"), []);
  assert.deepEqual(h.emitted, [], "nothing reached the room either");
});

test("an attachment on a post is catalogued and referenced into its conversation", async () => {
  const h = makeRouter();
  await withWorker(h.sessions);

  await h.router.post({
    sessionId: "s1",
    conversationId: "sub-1",
    author: WORKER,
    content: "here is the data",
    attachments: [
      {
        name: "data.csv",
        path: "uploads/data.csv",
        size: 128,
        contentType: "text/csv",
      },
    ],
  });

  const referenced = await h.resourceStore.listForConversation("s1", "sub-1");
  assert.equal(referenced.length, 1);
  assert.equal(referenced[0].kind, "attachment");
  assert.equal(referenced[0].uri, "uploads/data.csv");
  assert.equal(referenced[0].authorParticipantId, "sub-1");
  assert.deepEqual(referenced[0].meta, { size: 128, contentType: "text/csv" });
});

test("a memory write on a post is catalogued and referenced into its conversation", async () => {
  const h = makeRouter();
  await withWorker(h.sessions);

  await h.router.post({
    sessionId: "s1",
    conversationId: "sub-1",
    author: WORKER,
    content: "remembered a preference",
    memory: { scope: "session" },
  });

  const referenced = await h.resourceStore.listForConversation("s1", "sub-1");
  assert.equal(referenced.length, 1);
  assert.equal(referenced[0].kind, "memory");
  assert.equal(referenced[0].uri, "memory://session");
});

test("posting into the conversation it was written from is an ordinary post", async () => {
  const h = makeRouter();
  await withWorker(h.sessions);

  const { message } = await h.router.postToConversation({
    sessionId: "s1",
    conversationId: "sub-1",
    fromConversation: "sub-1",
    author: WORKER,
    content: "progress",
  });

  assert.deepEqual(
    message?.source,
    { kind: "agent" },
    "its own thread is not somewhere else",
  );
});

test("an opaque member is sent the addressing Message plain, a shared one framed", () => {
  const msg: ChatMessage = {
    id: "m1",
    sessionId: "s1",
    conversationId: "room",
    seq: 1,
    author: { id: "ada@x", kind: "human", name: "Ada" },
    source: { kind: "human" },
    mentions: ["peer-1"],
    content: "peer, are you there?",
    createdAt: new Date().toISOString(),
  };
  const opaque: Membership = {
    sessionId: "s1",
    participantId: "peer-1",
    conversationId: "room",
    reaction: "mentionsMe",
    ingress: "reaction",
    transcriptVisibility: "opaque",
  };
  const shared: Membership = {
    ...opaque,
    participantId: "sub-9",
    transcriptVisibility: "shared",
  };

  // Neither is the owner ("prime"). The opaque peer, which sees none of the
  // log, gets only the Message; the shared member gets the provenance framing.
  assert.equal(deliveryText(msg, opaque, "prime"), "peer, are you there?");
  assert.match(
    deliveryText(msg, shared, "prime"),
    /posted in another conversation/,
  );
});
