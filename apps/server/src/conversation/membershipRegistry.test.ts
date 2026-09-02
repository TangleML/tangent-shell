import assert from "node:assert/strict";
import { test } from "node:test";

import { connectorFor } from "@tangent/shared/contracts.ts";

import { InMemoryMembershipStore } from "../store/inMemoryMembershipStore.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import type { Membership } from "../store/membershipStore.ts";
import { MembershipRegistry } from "./membershipRegistry.ts";

/**
 * A registry over in-memory stores. Every connector the server runs today can be
 * delivered to, so the default matches reality; the tests that care about the
 * refusing case say so themselves.
 */
function makeRegistry(acceptsDelivery: () => boolean = () => true) {
  const sessions = new InMemorySessionStore();
  const store = new InMemoryMembershipStore();
  const registry = new MembershipRegistry(sessions, store, acceptsDelivery);
  return { sessions, store, registry };
}

/** `(participantId, reaction)` pairs, which is what a derivation is about. */
function shape(members: Membership[]): [string, string][] {
  return members.map((member) => [member.participantId, member.reaction]);
}

test("Prime's own conversation holds Prime, reacting to people and mentions", async () => {
  const h = makeRegistry();

  const members = await h.registry.membersOf("s1", "prime");

  assert.deepEqual(shape(members), [["prime", "fromHumans+mentionsMe"]]);
});

test("an auto-relaying sub-agent's conversation puts Prime on its run ends", async () => {
  const h = makeRegistry();
  await h.sessions.recordAgent("s1", {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
    status: "active",
    autoRelayToPrime: true,
    homeConversationId: "sub-1",
    connector: connectorFor("pi-stdio"),
  });

  const members = await h.registry.membersOf("s1", "sub-1");

  assert.deepEqual(shape(members), [
    ["sub-1", "fromHumans+mentionsMe"],
    ["prime", "atRunEnd+mentionsMe"],
  ]);
  // The worker queues wakes in its own thread; the orchestrator watching it
  // coalesces a burst of run-end relays into one follow-up.
  assert.equal(members[0].admission, "queue");
  assert.equal(members[1].admission, "coalesce");
});

test("the orchestrator's own conversation queues wakes", async () => {
  const h = makeRegistry();

  const members = await h.registry.membersOf("s1", "prime");

  assert.equal(members[0].admission, "queue");
});

test("a sub-agent that does not auto-relay is reachable only by being addressed", async () => {
  const h = makeRegistry();
  await h.sessions.recordAgent("s1", {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
    status: "active",
    autoRelayToPrime: false,
    homeConversationId: "sub-1",
    connector: connectorFor("pi-stdio"),
  });

  const members = await h.registry.membersOf("s1", "sub-1");

  assert.deepEqual(shape(members), [
    ["sub-1", "fromHumans+mentionsMe"],
    ["prime", "mentionsMe"],
  ]);
});

test("a participant nothing can deliver to declares that it never reacts", async () => {
  const h = makeRegistry(() => false);
  await h.sessions.recordAgent("s1", {
    id: "tab-1",
    role: "subagent",
    name: "External",
    status: "active",
    homeConversationId: "tab-1",
    connector: connectorFor("external-inbound"),
  });

  const members = await h.registry.membersOf("s1", "tab-1");

  assert.deepEqual(shape(members), [
    ["tab-1", "never"],
    ["prime", "atRunEnd+mentionsMe"],
  ]);
  assert.equal(members[0].transcriptVisibility, "opaque");
});

test("an external worker is addressable but sees none of the transcript", async () => {
  const h = makeRegistry();
  await h.sessions.recordAgent("s1", {
    id: "tab-1",
    role: "subagent",
    name: "External",
    status: "active",
    homeConversationId: "tab-1",
    connector: connectorFor("external-inbound"),
  });

  const members = await h.registry.membersOf("s1", "tab-1");

  // Its driver collects what Tangent queues for it, so it reacts like any other
  // sub-agent — while still being sent what addresses it rather than the log.
  assert.deepEqual(shape(members), [
    ["tab-1", "fromHumans+mentionsMe"],
    ["prime", "atRunEnd+mentionsMe"],
  ]);
  assert.equal(members[0].transcriptVisibility, "opaque");
});

test("an A2A peer is addressable but sees none of the transcript", async () => {
  const h = makeRegistry();
  await h.sessions.recordAgent("s1", {
    id: "peer-1",
    role: "subagent",
    name: "Weather",
    status: "active",
    homeConversationId: "peer-1",
    connector: connectorFor("a2a"),
  });

  const members = await h.registry.membersOf("s1", "peer-1");

  // Reachable, so it reacts — but it sits outside Tangent's trust domain, so it
  // is sent what addresses it rather than the log. Prime, being local, reads the
  // thread in full.
  assert.deepEqual(shape(members), [
    ["peer-1", "fromHumans+mentionsMe"],
    ["prime", "atRunEnd+mentionsMe"],
  ]);
  assert.equal(members[0].transcriptVisibility, "opaque");
  assert.equal(members[1].transcriptVisibility, "shared");
});

test("a local sub-agent still sees the shared transcript", async () => {
  const h = makeRegistry();
  await h.sessions.recordAgent("s1", {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
    status: "active",
    connector: connectorFor("pi-stdio"),
  });

  const members = await h.registry.membersOf("s1", "sub-1");

  assert.equal(members[0].transcriptVisibility, "shared");
});

test("a derived conversation is persisted, so it is derived once", async () => {
  const h = makeRegistry();
  await h.sessions.recordAgent("s1", {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
    status: "active",
    autoRelayToPrime: false,
    homeConversationId: "sub-1",
    connector: connectorFor("pi-stdio"),
  });

  await h.registry.membersOf("s1", "sub-1");

  // A second registry over the same store reads rows rather than re-deriving —
  // which is what makes a later edit to a membership stick.
  const reopened = new MembershipRegistry(h.sessions, h.store, () => true);
  assert.deepEqual(shape(await reopened.membersOf("s1", "sub-1")), [
    ["sub-1", "fromHumans+mentionsMe"],
    ["prime", "mentionsMe"],
  ]);
});

test("a stored membership wins over what the roster would derive", async () => {
  const h = makeRegistry();
  await h.sessions.recordAgent("s1", {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
    status: "active",
    autoRelayToPrime: true,
    homeConversationId: "sub-1",
    connector: connectorFor("pi-stdio"),
  });
  await h.store.put({
    sessionId: "s1",
    participantId: "prime",
    conversationId: "sub-1",
    reaction: "never",
    ingress: "reaction",
    admission: "queue",
    transcriptVisibility: "shared",
  });

  assert.deepEqual(shape(await h.registry.membersOf("s1", "sub-1")), [
    ["prime", "never"],
  ]);
});

test("membership answers whether one participant stands in a conversation", async () => {
  const h = makeRegistry();
  await h.sessions.recordAgent("s1", {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
    status: "active",
    autoRelayToPrime: true,
    homeConversationId: "sub-1",
    connector: connectorFor("pi-stdio"),
  });

  // What lets the orchestrator be woken by a worker's thread is what authorizes
  // it to write into one; a peer worker holds no standing there at all.
  const prime = await h.registry.memberIn("s1", "sub-1", "prime");
  assert.equal(prime?.reaction, "atRunEnd+mentionsMe");
  assert.equal(await h.registry.memberIn("s1", "sub-1", "sub-2"), undefined);
});

test("a spawn whose row has not landed yet still resolves, without being kept", async () => {
  const h = makeRegistry();

  // The window between a spawn and its persisted roster row: the first task has
  // to reach the sub-agent, but the row's own facts must win once it exists.
  assert.deepEqual(shape(await h.registry.membersOf("s1", "sub-1")), [
    ["sub-1", "fromHumans+mentionsMe"],
    ["prime", "atRunEnd+mentionsMe"],
  ]);
  assert.deepEqual(await h.store.listForSession("s1"), []);

  await h.sessions.recordAgent("s1", {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
    status: "active",
    autoRelayToPrime: false,
    homeConversationId: "sub-1",
    connector: connectorFor("pi-stdio"),
  });

  assert.deepEqual(shape(await h.registry.membersOf("s1", "sub-1")), [
    ["sub-1", "fromHumans+mentionsMe"],
    ["prime", "mentionsMe"],
  ]);
});
