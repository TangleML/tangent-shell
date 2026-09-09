import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { connectorFor } from "@tangent/shared/contracts.ts";

// Point the session root at a throwaway dir before importing modules that read
// config at load time, so `createSession`'s mkdir never touches the repo.
const ROOT = mkdtempSync(path.join(tmpdir(), "participant-service-"));
process.env.SESSIONS_ROOT = ROOT;

const { ParticipantService } = await import("./participantService.ts");
const { ParticipantRegistry } = await import("./participantRegistry.ts");
const { MembershipRegistry } = await import("./membershipRegistry.ts");
const { reactionSpec } = await import("./reaction.ts");
const { RunRegistry } = await import("../runs/runRegistry.ts");
const { InMemorySessionStore } =
  await import("../store/inMemorySessionStore.ts");
const { InMemoryParticipantStore } =
  await import("../store/inMemoryParticipantStore.ts");
const { InMemoryMembershipStore } =
  await import("../store/inMemoryMembershipStore.ts");
const { InMemoryRunStore } = await import("../store/inMemoryRunStore.ts");

type ConnectorRegistry =
  import("../connectors/connectorRegistry.ts").ConnectorRegistry;
type ParticipantPresencePayload =
  import("@tangent/shared/contracts.ts").ParticipantPresencePayload;

after(() => rmSync(ROOT, { recursive: true, force: true }));

/** A real service over in-memory stores, plus the seams a test asserts on. */
async function harness() {
  const participantStore = new InMemoryParticipantStore();
  const sessions = new InMemorySessionStore(participantStore);
  const membershipStore = new InMemoryMembershipStore();
  const participantRegistry = new ParticipantRegistry(
    sessions,
    participantStore,
  );
  const memberships = new MembershipRegistry(
    sessions,
    membershipStore,
    () => true,
  );
  const runs = new RunRegistry(new InMemoryRunStore());
  const cancelled: string[] = [];
  const presenceEvents: ParticipantPresencePayload[] = [];
  const connectors = {
    cancelRun: (req: { participantId: string }) => {
      cancelled.push(req.participantId);
      return { cancelled: true };
    },
  } as unknown as ConnectorRegistry;
  const service = new ParticipantService(
    participantStore,
    membershipStore,
    participantRegistry,
    memberships,
    runs,
    connectors,
    (payload) => presenceEvents.push(payload),
  );
  const session = await sessions.createSession({ name: "S" });
  return {
    service,
    sessions,
    participantStore,
    membershipStore,
    memberships,
    runs,
    session,
    cancelled,
    presenceEvents,
  };
}

test("invite creates an away human keyed by email, with memberships", async () => {
  const { service, session } = await harness();

  const participant = await service.invite(session.id, {
    email: "a@shopify.com",
    conversationIds: ["prime"],
  });

  assert.equal(participant.id, "a@shopify.com");
  assert.equal(participant.kind, "human");
  assert.equal(participant.presence, "away");
  const memberships = await service.membershipsOf(session.id, "a@shopify.com");
  assert.deepEqual(
    memberships.map((m) => m.conversationId),
    ["prime"],
  );
});

test("inviting into Prime's conversation keeps Prime a member", async () => {
  const { service, memberships, sessions, session } = await harness();
  // Prime's home Conversation is a minted id now, not the reserved "prime".
  const [prime] = await sessions.listAgents(session.id);
  const primeConversationId = prime.homeConversationId;

  await service.invite(session.id, {
    email: "a@shopify.com",
    conversationIds: [primeConversationId],
  });

  const members = await memberships.membersOf(session.id, primeConversationId);
  const ids = members.map((m) => m.participantId).sort();
  assert.deepEqual(ids, ["a@shopify.com", "prime"]);
});

test("an invited human's membership is inert, so fan-out never wakes them", async () => {
  const { service, memberships, session } = await harness();

  await service.invite(session.id, {
    email: "a@shopify.com",
    conversationIds: ["prime"],
  });

  const membership = await memberships.memberIn(
    session.id,
    "prime",
    "a@shopify.com",
  );
  assert.equal(membership?.reaction, "never");
});

test("revoke removes memberships, retains the row, and broadcasts detached", async () => {
  const { service, session, presenceEvents } = await harness();
  await service.invite(session.id, {
    email: "a@shopify.com",
    conversationIds: ["prime"],
  });

  await service.revoke(session.id, "a@shopify.com");

  const participant = await service.get(session.id, "a@shopify.com");
  assert.ok(participant, "a revoked participant is retained");
  assert.ok(participant.revokedAt);
  assert.equal(participant.presence, "detached");
  assert.deepEqual(
    await service.membershipsOf(session.id, "a@shopify.com"),
    [],
  );
  assert.deepEqual(presenceEvents.at(-1), {
    sessionId: session.id,
    participantId: "a@shopify.com",
    presence: "detached",
  });
});

test("re-inviting a revoked human clears the revocation", async () => {
  const { service, session } = await harness();
  await service.invite(session.id, { email: "a@shopify.com" });
  await service.revoke(session.id, "a@shopify.com");

  await service.invite(session.id, { email: "a@shopify.com" });

  const participant = await service.get(session.id, "a@shopify.com");
  assert.equal(participant?.revokedAt, undefined);
  assert.equal(participant?.presence, "away");
});

test("join then leave adds and removes a single membership", async () => {
  const { service, session } = await harness();
  await service.invite(session.id, { email: "a@shopify.com" });

  await service.join(session.id, "a@shopify.com", "prime");
  assert.equal(
    (await service.membershipsOf(session.id, "a@shopify.com")).length,
    1,
  );

  await service.leave(session.id, "a@shopify.com", "prime");
  assert.deepEqual(
    await service.membershipsOf(session.id, "a@shopify.com"),
    [],
  );
});

test("join places an opaque room member woken only when addressed", async () => {
  const { service, sessions, memberships, session } = await harness();
  const [prime] = await sessions.listAgents(session.id);
  await sessions.recordAgent(session.id, {
    id: "peer-1",
    role: "subagent",
    name: "Weather",
    connector: connectorFor("a2a"),
    homeConversationId: "peer-home",
  });

  await service.join(session.id, "peer-1", prime.homeConversationId, {
    reaction: reactionSpec("mentionsMe"),
    transcriptVisibility: "opaque",
  });

  const membership = await memberships.memberIn(
    session.id,
    prime.homeConversationId,
    "peer-1",
  );
  assert.equal(membership?.reaction, "mentionsMe");
  assert.equal(membership?.transcriptVisibility, "opaque");
});

test("an agent joins with its connector's default visibility", async () => {
  const { service, sessions, memberships, session } = await harness();
  const [prime] = await sessions.listAgents(session.id);
  await sessions.recordAgent(session.id, {
    id: "peer-1",
    role: "subagent",
    name: "Weather",
    connector: connectorFor("a2a"),
    homeConversationId: "peer-home",
  });

  await service.join(session.id, "peer-1", prime.homeConversationId);

  // a2a is opaque by default; the reaction falls back to the agent default.
  const membership = await memberships.memberIn(
    session.id,
    prime.homeConversationId,
    "peer-1",
  );
  assert.equal(membership?.transcriptVisibility, "opaque");
  assert.equal(membership?.reaction, "fromHumans+mentionsMe");
});

test("closeConversation ends memberships and settles the open run", async () => {
  const { service, memberships, membershipStore, runs, session, cancelled } =
    await harness();
  // Materialize the conversation's base memberships, then open a run on it.
  await memberships.membersOf(session.id, "prime");
  runs.open({
    sessionId: session.id,
    participantId: "prime",
    ingress: "reaction",
  });

  await service.closeConversation(session.id, "prime");

  assert.equal(runs.current(session.id, "prime"), undefined);
  assert.ok(cancelled.includes("prime"));
  // The stored rows are gone; the registry would re-derive a live agent's own
  // membership, which is why the store is what a close is asserted against.
  assert.deepEqual(
    await membershipStore.listForConversation(session.id, "prime"),
    [],
  );
});

test("ensureAutomation is idempotent and materializes an inert member", async () => {
  const { service, memberships, participantStore, session } = await harness();

  await service.ensureAutomation(session.id, "memory", "Memory", "reaction");
  await service.ensureAutomation(session.id, "memory", "Memory", "reaction");

  const memory = await participantStore.get(session.id, "memory");
  assert.equal(memory?.kind, "automation");
  const membership = await memberships.memberIn(session.id, "prime", "memory");
  assert.equal(membership?.reaction, "never");
  assert.equal(membership?.ingress, "reaction");
});

test("setPresence writes, broadcasts, and skips a no-op transition", async () => {
  const { service, session, presenceEvents } = await harness();
  await service.invite(session.id, { email: "a@shopify.com" });

  await service.setPresence(session.id, "a@shopify.com", "connected");
  await service.setPresence(session.id, "a@shopify.com", "connected");

  const participant = await service.get(session.id, "a@shopify.com");
  assert.equal(participant?.presence, "connected");
  const forThisPerson = presenceEvents.filter(
    (p) => p.participantId === "a@shopify.com",
  );
  assert.equal(
    forThisPerson.length,
    1,
    "an unchanged presence is not re-broadcast",
  );
});

test("setPresence ignores a revoked participant", async () => {
  const { service, session } = await harness();
  await service.invite(session.id, { email: "a@shopify.com" });
  await service.revoke(session.id, "a@shopify.com");

  await service.setPresence(session.id, "a@shopify.com", "connected");

  const participant = await service.get(session.id, "a@shopify.com");
  assert.equal(participant?.presence, "detached");
});
