import assert from "node:assert/strict";
import { test } from "node:test";

import {
  connectorFor,
  type SubagentInfo,
  type TerminationCause,
} from "@tangent/shared/contracts.ts";
import type { Server } from "socket.io";

import type { ConversationRouter } from "../conversation/conversationRouter.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import { createSubagentUpdateHandler } from "./agentEvents.ts";

const io = { to: () => ({ emit: () => {} }) } as unknown as Server;

/** A router stub that records only what the roster handler asks of it. */
function fakeConversations() {
  const announced: { sessionId: string; cause: TerminationCause }[] = [];
  const conversations = {
    waveDepth: () => 0,
    announceCause: (sessionId: string, cause: TerminationCause) =>
      announced.push({ sessionId, cause }),
  } as unknown as ConversationRouter;
  return { conversations, announced };
}

/** A roster update payload the handler reacts to. `conversationId` is the
 * worker's home, where a detach cause is posted. */
function subagent(overrides: Partial<SubagentInfo> = {}): SubagentInfo {
  return {
    id: "w3",
    conversationId: "B3",
    name: "Worker 3",
    status: "detached",
    connector: connectorFor("pi-stdio"),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test("a live worker dropping to detached surfaces a connector-detached cause once", async () => {
  const store = new InMemorySessionStore();
  await store.recordAgent("s1", {
    id: "w3",
    role: "subagent",
    name: "Worker 3",
    status: "active",
    connector: connectorFor("pi-stdio"),
  });
  const { conversations, announced } = fakeConversations();
  const handler = createSubagentUpdateHandler(io, store, conversations);

  await handler("s1", subagent({ status: "detached" }));

  assert.equal(announced.length, 1, "the transition posts exactly one cause");
  const { cause } = announced[0];
  assert.equal(cause.kind, "connector-detached");
  assert.equal(cause.participantId, "w3");
  assert.equal(cause.conversationId, "B3");
});

test("reattaching an already-detached worker posts no cause", async () => {
  const store = new InMemorySessionStore();
  await store.recordAgent("s1", {
    id: "w3",
    role: "subagent",
    name: "Worker 3",
    status: "detached",
    connector: connectorFor("pi-stdio"),
  });
  const { conversations, announced } = fakeConversations();
  const handler = createSubagentUpdateHandler(io, store, conversations);

  await handler("s1", subagent({ status: "detached" }));

  assert.deepEqual(announced, [], "no active→detached transition happened");
});

test("a fresh worker coming up active posts no cause", async () => {
  const store = new InMemorySessionStore();
  const { conversations, announced } = fakeConversations();
  const handler = createSubagentUpdateHandler(io, store, conversations);

  await handler("s1", subagent({ status: "active" }));

  assert.deepEqual(announced, []);
});
