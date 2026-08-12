import assert from "node:assert/strict";
import { test } from "node:test";

import { connectorFor } from "@tangent/shared/contracts.ts";

import { InMemoryMembershipStore } from "../store/inMemoryMembershipStore.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import type { Membership } from "../store/membershipStore.ts";
import { MembershipRegistry } from "./membershipRegistry.ts";

/** A registry over in-memory stores; external tabs accept no delivery. */
function makeRegistry() {
  const sessions = new InMemorySessionStore();
  const store = new InMemoryMembershipStore();
  const registry = new MembershipRegistry(
    sessions,
    store,
    (kind) => kind !== "external-inbound",
  );
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
    connector: connectorFor("pi-stdio"),
  });

  const members = await h.registry.membersOf("s1", "sub-1");

  assert.deepEqual(shape(members), [
    ["sub-1", "fromHumans+mentionsMe"],
    ["prime", "atRunEnd+mentionsMe"],
  ]);
});

test("a sub-agent that does not auto-relay is reachable only by being addressed", async () => {
  const h = makeRegistry();
  await h.sessions.recordAgent("s1", {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
    status: "active",
    autoRelayToPrime: false,
    connector: connectorFor("pi-stdio"),
  });

  const members = await h.registry.membersOf("s1", "sub-1");

  assert.deepEqual(shape(members), [
    ["sub-1", "fromHumans+mentionsMe"],
    ["prime", "mentionsMe"],
  ]);
});

test("a participant nothing can deliver to declares that it never reacts", async () => {
  const h = makeRegistry();
  await h.sessions.recordAgent("s1", {
    id: "tab-1",
    role: "subagent",
    name: "External",
    status: "active",
    connector: connectorFor("external-inbound"),
  });

  const members = await h.registry.membersOf("s1", "tab-1");

  assert.deepEqual(shape(members), [
    ["tab-1", "never"],
    ["prime", "atRunEnd+mentionsMe"],
  ]);
  assert.equal(members[0].transcriptVisibility, "opaque");
});

test("a derived conversation is persisted, so it is derived once", async () => {
  const h = makeRegistry();
  await h.sessions.recordAgent("s1", {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
    status: "active",
    autoRelayToPrime: false,
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
    connector: connectorFor("pi-stdio"),
  });
  await h.store.put({
    sessionId: "s1",
    participantId: "prime",
    conversationId: "sub-1",
    reaction: "never",
    ingress: "reaction",
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
    connector: connectorFor("pi-stdio"),
  });

  assert.deepEqual(shape(await h.registry.membersOf("s1", "sub-1")), [
    ["sub-1", "fromHumans+mentionsMe"],
    ["prime", "mentionsMe"],
  ]);
});
