import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir before importing modules that read
// config at load time, so `createSession`'s mkdir never touches the repo.
const ROOT = mkdtempSync(path.join(tmpdir(), "participants-rest-"));
process.env.SESSIONS_ROOT = ROOT;

const express = (await import("express")).default;
const { Router } = await import("express");
const { registerParticipantRoutes } = await import("./participants.ts");
const { inviteParticipantSchema } = await import("./schemas.ts");
const { ParticipantService } =
  await import("../../conversation/participantService.ts");
const { ParticipantRegistry } =
  await import("../../conversation/participantRegistry.ts");
const { MembershipRegistry } =
  await import("../../conversation/membershipRegistry.ts");
const { RunRegistry } = await import("../../runs/runRegistry.ts");
const { InMemorySessionStore } =
  await import("../../store/inMemorySessionStore.ts");
const { InMemoryParticipantStore } =
  await import("../../store/inMemoryParticipantStore.ts");
const { InMemoryMembershipStore } =
  await import("../../store/inMemoryMembershipStore.ts");
const { InMemoryRunStore } = await import("../../store/inMemoryRunStore.ts");

type ConnectorRegistry =
  import("../../connectors/connectorRegistry.ts").ConnectorRegistry;

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
  rmSync(ROOT, { recursive: true, force: true });
});

/** A running express app mounting the participant routes over real stores. */
async function serve() {
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

  const app = express();
  app.use(express.json());
  const router = Router();
  registerParticipantRoutes(router, sessions, service);
  app.use("/api/sessions", router);

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  cleanups.push(() => server.close());
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/sessions`;

  const call = async <T = unknown>(
    method: string,
    pathname: string,
    body?: unknown,
  ): Promise<{ status: number; json: T }> => {
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return {
      status: res.status,
      json: (text ? JSON.parse(text) : undefined) as T,
    };
  };

  return { call, sessionId: session.id };
}

test("inviteParticipantSchema requires a valid email", () => {
  assert.equal(inviteParticipantSchema.safeParse({}).success, false);
  assert.equal(
    inviteParticipantSchema.safeParse({ email: "nope" }).success,
    false,
  );
  assert.equal(
    inviteParticipantSchema.safeParse({ email: "a@shopify.com" }).success,
    true,
  );
});

test("GET participants lists the roster, including Prime", async () => {
  const { call, sessionId } = await serve();

  const { status, json } = await call<{ participants: { id: string }[] }>(
    "GET",
    `/${sessionId}/participants`,
  );

  assert.equal(status, 200);
  assert.ok(json.participants.map((p) => p.id).includes("prime"));
});

test("POST invite then GET shows the human as away", async () => {
  const { call, sessionId } = await serve();

  const invited = await call<{
    participant: { kind: string; presence: string };
  }>("POST", `/${sessionId}/participants`, {
    email: "a@shopify.com",
    conversationIds: ["prime"],
  });
  assert.equal(invited.status, 201);
  assert.equal(invited.json.participant.kind, "human");
  assert.equal(invited.json.participant.presence, "away");

  const list = await call<{
    participants: {
      id: string;
      memberships: { conversationId: string }[];
    }[];
  }>("GET", `/${sessionId}/participants`);
  const human = list.json.participants.find((p) => p.id === "a@shopify.com");
  assert.ok(human);
  assert.deepEqual(
    human.memberships.map((m) => m.conversationId),
    ["prime"],
  );
});

test("membership join then leave, and revoke, drive the right statuses", async () => {
  const { call, sessionId } = await serve();
  await call("POST", `/${sessionId}/participants`, { email: "a@shopify.com" });

  const joined = await call(
    "POST",
    `/${sessionId}/participants/a@shopify.com/memberships`,
    { conversationId: "prime" },
  );
  assert.equal(joined.status, 201);

  const left = await call(
    "DELETE",
    `/${sessionId}/participants/a@shopify.com/memberships/prime`,
  );
  assert.equal(left.status, 204);

  const revoked = await call(
    "DELETE",
    `/${sessionId}/participants/a@shopify.com`,
  );
  assert.equal(revoked.status, 204);
});

test("muting a human membership is refused", async () => {
  const { call, sessionId } = await serve();
  await call("POST", `/${sessionId}/participants`, { email: "a@shopify.com" });
  await call("POST", `/${sessionId}/participants/a@shopify.com/memberships`, {
    conversationId: "prime",
  });

  const muted = await call(
    "PATCH",
    `/${sessionId}/participants/a@shopify.com/memberships/prime`,
    { muted: true },
  );

  assert.equal(muted.status, 400);
});

test("routes 404 for an unknown session", async () => {
  const { call } = await serve();
  const { status, json } = await call<{ error: string }>(
    "GET",
    "/missing/participants",
  );
  assert.equal(status, 404);
  assert.deepEqual(json, { error: "Session not found" });
});

test("revoking an unknown participant 404s", async () => {
  const { call, sessionId } = await serve();
  const { status } = await call(
    "DELETE",
    `/${sessionId}/participants/ghost@shopify.com`,
  );
  assert.equal(status, 404);
});
