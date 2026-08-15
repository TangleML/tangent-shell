import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir before importing modules that read
// config at load time, so `createSession`'s mkdir never touches the repo.
const ROOT = mkdtempSync(path.join(tmpdir(), "mentions-test-"));
process.env.SESSIONS_ROOT = ROOT;

const { resolveMentions } = await import("./mentions.ts");
const { mentionCandidates } = await import("./chat.ts");
const { ParticipantService } =
  await import("../conversation/participantService.ts");
const { ParticipantRegistry } =
  await import("../conversation/participantRegistry.ts");
const { MembershipRegistry } =
  await import("../conversation/membershipRegistry.ts");
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

after(() => rmSync(ROOT, { recursive: true, force: true }));

/** A ParticipantService over in-memory stores, plus a connector-less roster. */
async function setup() {
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
  const connectors = {
    cancelRun: () => ({ cancelled: true }),
  } as unknown as ConnectorRegistry;
  const service = new ParticipantService(
    participantStore,
    membershipStore,
    participantRegistry,
    memberships,
    runs,
    connectors,
  );
  const session = await sessions.createSession({ name: "S" });
  // No sub-agents; the mention roster is Prime plus invited humans only.
  const noConnectors = { list: () => [] } as unknown as ConnectorRegistry;
  return { service, connectors: noConnectors, sessionId: session.id };
}

test("an invited human is a mention candidate and @name resolves to their id", async () => {
  const { service, connectors, sessionId } = await setup();
  await service.invite(sessionId, {
    email: "ada@shopify.com",
    displayName: "Ada Lovelace",
  });

  const candidates = await mentionCandidates(connectors, service, sessionId);
  assert.ok(
    candidates.some(
      (c) => c.id === "ada@shopify.com" && c.name === "Ada Lovelace",
    ),
    "the invited human should be a candidate",
  );

  // Multiword names are reachable when typed without spaces (server normalizes).
  const resolved = resolveMentions(
    "hey @AdaLovelace can you look?",
    candidates,
  );
  assert.deepEqual(resolved, ["ada@shopify.com"]);
});

test("a revoked human is dropped from the mention roster", async () => {
  const { service, connectors, sessionId } = await setup();
  await service.invite(sessionId, {
    email: "ada@shopify.com",
    displayName: "Ada Lovelace",
  });
  await service.revoke(sessionId, "ada@shopify.com");

  const candidates = await mentionCandidates(connectors, service, sessionId);
  assert.ok(!candidates.some((c) => c.id === "ada@shopify.com"));
});
