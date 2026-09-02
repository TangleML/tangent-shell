import assert from "node:assert/strict";
import { test } from "node:test";

import { connectorFor } from "@tangent/shared/contracts.ts";

import { InMemoryParticipantStore } from "../store/inMemoryParticipantStore.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import type { Participant } from "../store/participantStore.ts";
import {
  homeConversationFor,
  orchestratorConversationFor,
  orchestratorIdFor,
  participantForConversation,
  ParticipantRegistry,
} from "./participantRegistry.ts";

/** A registry over in-memory stores, roster empty until agents are recorded. */
function makeRegistry() {
  const sessions = new InMemorySessionStore();
  const store = new InMemoryParticipantStore();
  return {
    sessions,
    store,
    registry: new ParticipantRegistry(sessions, store),
  };
}

test("derives a participant per roster row, persisting the derived rows", async () => {
  const { sessions, store, registry } = makeRegistry();
  await sessions.recordAgent("s1", {
    id: "prime",
    role: "prime",
    name: "Prime",
  });
  await sessions.recordAgent("s1", {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
  });

  const participants = await registry.listForSession("s1");
  const prime = participants.find((p) => p.id === "prime");
  const sub = participants.find((p) => p.id === "sub-1");

  assert.equal(prime?.kind, "agent");
  assert.deepEqual(prime?.capabilities, ["orchestrator", "supervisor"]);
  assert.deepEqual(sub?.capabilities, []);
  // The derivation was persisted, so a later read has a stored row to find.
  assert.equal((await store.get("s1", "prime"))?.displayName, "Prime");
});

test("orchestratorId resolves the capability holder", async () => {
  const { sessions, registry } = makeRegistry();
  await sessions.recordAgent("s1", {
    id: "prime",
    role: "prime",
    name: "Prime",
  });
  assert.equal(await registry.orchestratorId("s1"), "prime");
});

test("orchestrator resolution falls back to the well-known id", async () => {
  const { sessions, registry } = makeRegistry();
  assert.equal(await registry.orchestratorId("empty"), "prime");
  assert.equal(await orchestratorIdFor(sessions, "empty"), "prime");
});

test("a stored non-agent participant is returned alongside derived agents", async () => {
  const { sessions, store, registry } = makeRegistry();
  await sessions.recordAgent("s1", {
    id: "prime",
    role: "prime",
    name: "Prime",
  });
  const human: Participant = {
    id: "ada@example.com",
    sessionId: "s1",
    kind: "human",
    displayName: "Ada",
    capabilities: [],
    presence: "connected",
    connector: connectorFor("unresolved"),
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  await store.put(human);

  const ids = (await registry.listForSession("s1")).map((p) => p.id).sort();
  assert.deepEqual(ids, ["ada@example.com", "prime"]);
});

test("the current roster row wins over a stale stored participant", async () => {
  const { sessions, store, registry } = makeRegistry();
  await store.put({
    id: "prime",
    sessionId: "s1",
    kind: "agent",
    displayName: "Stale Name",
    capabilities: ["orchestrator"],
    presence: "connected",
    connector: connectorFor("pi-stdio"),
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  await sessions.recordAgent("s1", {
    id: "prime",
    role: "prime",
    name: "Prime",
  });

  assert.equal((await registry.get("s1", "prime"))?.displayName, "Prime");
});

test("home conversation resolves and reverses through the mapping", async () => {
  const { sessions } = makeRegistry();
  const recorded = await sessions.recordAgent("s1", {
    id: "sub-1",
    role: "subagent",
    name: "Worker",
  });

  const home = await homeConversationFor(sessions, "s1", "sub-1");
  assert.equal(home, recorded.homeConversationId);
  assert.notEqual(home, "sub-1", "a new agent's conversation is a fresh id");
  assert.equal(
    await participantForConversation(sessions, "s1", home),
    "sub-1",
    "the reverse map recovers the owning participant",
  );
});

test("resolution falls back to the id for an unmapped agent or conversation", async () => {
  const { sessions } = makeRegistry();
  assert.equal(await homeConversationFor(sessions, "s1", "ghost"), "ghost");
  assert.equal(
    await participantForConversation(sessions, "s1", "ghost"),
    "ghost",
  );
});

test("orchestratorConversationFor resolves the capability holder's home", async () => {
  const { sessions } = makeRegistry();
  const prime = await sessions.recordAgent("s1", {
    id: "prime",
    role: "prime",
    name: "Prime",
  });
  assert.equal(
    await orchestratorConversationFor(sessions, "s1"),
    prime.homeConversationId,
  );
  // An empty session has no orchestrator to resolve, so it falls back.
  assert.equal(await orchestratorConversationFor(sessions, "empty"), "prime");
});

test("recording an agent dual-writes the participant projection", async () => {
  const store = new InMemoryParticipantStore();
  const sessions = new InMemorySessionStore(store);
  await sessions.recordAgent("s1", {
    id: "prime",
    role: "prime",
    name: "Prime",
  });

  const mirrored = await store.get("s1", "prime");
  assert.equal(mirrored?.displayName, "Prime");
  assert.deepEqual(mirrored?.capabilities, ["orchestrator", "supervisor"]);
});
