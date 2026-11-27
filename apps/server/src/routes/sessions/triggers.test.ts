import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const ROOT = mkdtempSync(path.join(tmpdir(), "session-triggers-"));
process.env.SESSIONS_ROOT = ROOT;
process.env.TANGENT_INTERNAL_TOKEN = "internal-test-secret";
// Read once when `config.ts` loads: the header the tests present a user in.
process.env.AUTH_JWT_TOKEN_HEADER_NAME = "x-test-identity";

const express = (await import("express")).default;
const { TriggerEngine } = await import("../../pi/triggers/triggerEngine.ts");
const { TriggerManager } = await import("../../pi/triggers/triggerManager.ts");
const { InMemorySessionStore } =
  await import("../../store/inMemorySessionStore.ts");
const { InMemoryParticipantStore } =
  await import("../../store/inMemoryParticipantStore.ts");
const { openDb } = await import("../../store/db/client.ts");
const { SqliteSessionStore } =
  await import("../../store/sqliteSessionStore.ts");
const { SqliteTriggerDelegationStore } =
  await import("../../store/sqliteTriggerDelegationStore.ts");
const { handleDeleteSession } = await import("./handlers.ts");
const { registerTriggerRoutes } = await import("./triggers.ts");
const { IdentityAssertionCache } =
  await import("../../auth/identityAssertions.ts");
const { TriggerDelegations } =
  await import("../../pi/triggers/triggerDelegation.ts");
const { InMemoryTriggerDelegationStore } =
  await import("../../store/inMemoryTriggerDelegationStore.ts");

import type { Response } from "express";
import type { Server } from "socket.io";

import type { EgressResponse } from "../../bundleUi/egressAllowlist.ts";
import type { ConversationRouter } from "../../conversation/conversationRouter.ts";
import type { PiAgentManager } from "../../pi/piAgentManager.ts";
import type { DelegationEgress } from "../../pi/triggers/triggerDelegation.ts";
import type { TriggerManager as Triggers } from "../../pi/triggers/triggerManager.ts";
import type { SessionStore } from "../../store/sessionStore.ts";

function jwt(claims: Record<string, unknown>): string {
  const segment = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `h.${segment(claims)}.sig`;
}
const SOON = Math.floor(Date.now() / 1000) + 600;
const ALICE = jwt({ email: "alice@x", exp: SOON });
const BOB = jwt({ email: "bob@x", exp: SOON });
const CAROL = jwt({ email: "carol@x", exp: SOON });

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
  rmSync(ROOT, { recursive: true, force: true });
});

const DELEGATED = {
  participantId: "alice@x",
  delegationId: "d1",
  delegationToken: "delegation-token",
};

/** An engine over a real manager, recording the delegations it revokes. */
function engineOver(store: SessionStore, triggers: Triggers) {
  const revoked: string[] = [];
  const engine = new TriggerEngine(
    { to: () => ({ emit: () => undefined }) } as unknown as Server,
    store,
    {} as PiAgentManager,
    triggers,
    {} as ConversationRouter,
    undefined,
    {
      revoke: async (delegationId) => {
        revoked.push(delegationId);
      },
    },
  );
  return { engine, revoked };
}

async function sessionWithDelegatedTrigger() {
  const store = new InMemorySessionStore(new InMemoryParticipantStore());
  const session = await store.createSession({ name: "S" });
  const triggers = new TriggerManager();
  const trigger = triggers.create(session.id, session.rootPath, {
    name: "hook",
    kind: "callback",
    prompt: "p",
  });
  triggers.setDelegation(session.id, trigger.id, DELEGATED);
  return { store, session, triggers, trigger };
}

test("deleting a trigger from the UI revokes its delegation", async () => {
  const { store, session, triggers, trigger } =
    await sessionWithDelegatedTrigger();
  const { engine, revoked } = engineOver(store, triggers);

  const router = express.Router();
  registerTriggerRoutes(router, store, triggers, engine);
  const app = express();
  app.use(express.json());
  app.use("/api/sessions", router);
  const server = app.listen(0);
  cleanups.push(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(
    `http://127.0.0.1:${port}/api/sessions/${session.id}/triggers/${trigger.id}`,
    { method: "DELETE" },
  );
  assert.equal(res.status, 204);
  assert.equal(triggers.get(session.id, trigger.id), undefined);
  assert.deepEqual(revoked, ["d1"]);
});

test("deleting a session revokes its triggers' delegations, even when nothing loaded them", async () => {
  const { store, session } = await sessionWithDelegatedTrigger();
  const cold = new TriggerManager();
  const { engine, revoked } = engineOver(store, cold);

  let status: number | undefined;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    end: () => undefined,
    json: () => undefined,
  };
  await handleDeleteSession(
    store,
    { dispose: () => undefined } as unknown as PiAgentManager,
    engine,
    session.id,
    res as unknown as Response,
  );

  assert.equal(status, 204);
  assert.deepEqual(revoked, ["d1"]);
  assert.equal(await store.getSession(session.id), undefined);
});

test("deleting a cold session whose triggers file still carries a token lifts, revokes and drops it", async () => {
  const db = openDb(":memory:");
  const store = new SqliteSessionStore(db);
  const tokens = new SqliteTriggerDelegationStore(db);
  const session = await store.createSession({ name: "S" });
  const dir = path.join(session.rootPath, ".tangent");
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    path.join(dir, "triggers.json"),
    JSON.stringify({
      triggers: [
        {
          id: "t1",
          name: "hook",
          kind: "callback",
          prompt: "p",
          enabled: true,
          source: "runtime",
          target: { type: "prime" },
          participantId: "alice@x",
          delegationId: "d1",
          delegationToken: "legacy-token",
          createdAt: now,
          updatedAt: now,
        },
      ],
    }),
  );
  const { engine, revoked } = engineOver(store, new TriggerManager(tokens));

  let status: number | undefined;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    end: () => undefined,
    json: () => undefined,
  };
  await handleDeleteSession(
    store,
    { dispose: () => undefined } as unknown as PiAgentManager,
    engine,
    session.id,
    res as unknown as Response,
  );

  assert.equal(status, 204);
  assert.deepEqual(revoked, ["d1"]);
  assert.equal(tokens.get(session.id, "t1"), undefined);
  assert.equal(await store.getSession(session.id), undefined);
});

interface BackendCall {
  method: string | undefined;
  path: string;
  identityToken: string | undefined;
}

/**
 * The session trigger API over a real manager and a fake backend that issues a
 * fresh delegation id per registration, with Alice and Bob holding live
 * assertions and Carol holding none.
 */
async function serveBound() {
  const store = new InMemorySessionStore(new InMemoryParticipantStore());
  const session = await store.createSession({ name: "S" });
  const triggers = new TriggerManager(new InMemoryTriggerDelegationStore());
  const backend: BackendCall[] = [];
  let issued = 0;
  const egress: DelegationEgress = async (input, init, _caller, opts) => {
    backend.push({
      method: init?.method,
      path: typeof input === "string" ? input : input.path,
      identityToken: opts.identityToken,
    });
    if (init?.method === "DELETE")
      return { ok: true, status: 204, headers: {} };
    issued += 1;
    const answer: EgressResponse = {
      ok: true,
      status: 201,
      headers: {},
      json: { id: `d${issued}`, token: `token-${issued}` },
    };
    return answer;
  };
  const assertions = new IdentityAssertionCache();
  assertions.record("alice@x", ALICE, "bearer");
  assertions.record("bob@x", BOB, "bearer");
  const delegations = new TriggerDelegations(
    egress,
    "/api/tangent/delegations",
    "x-tangent-on-behalf-of",
  );
  const engine = new TriggerEngine(
    { to: () => ({ emit: () => undefined }) } as unknown as Server,
    store,
    {
      ensure: async () => undefined,
      hasAgent: () => true,
    } as unknown as PiAgentManager,
    triggers,
    {} as ConversationRouter,
    undefined,
    delegations,
  );
  cleanups.push(() => engine.disarm(session.id));

  const router = express.Router();
  registerTriggerRoutes(router, store, triggers, engine, {
    delegations,
    assertions,
  });
  const app = express();
  app.use(express.json());
  app.use("/api/sessions", router);
  const server = app.listen(0);
  cleanups.push(() => server.close());
  const { port } = server.address() as AddressInfo;
  const call = (
    method: string,
    suffix: string,
    user: string | undefined,
    body?: unknown,
  ) =>
    fetch(
      `http://127.0.0.1:${port}/api/sessions/${session.id}/triggers${suffix}`,
      {
        method,
        headers: {
          "content-type": "application/json",
          ...(user ? { "x-test-identity": user } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
  const settled = () => new Promise((resolve) => setImmediate(resolve));
  return { session, triggers, backend, call, settled };
}

const NIGHTLY = {
  name: "nightly",
  kind: "schedule",
  prompt: "check in",
  schedule: { every: "1h" },
  target: "prime",
};

test("a trigger created from the session API is bound to the requesting user", async () => {
  const { session, triggers, backend, call } = await serveBound();

  const res = await call("POST", "", ALICE, NIGHTLY);
  assert.equal(res.status, 201);
  const { trigger } = (await res.json()) as { trigger: { id: string } };
  assert.deepEqual(backend, [
    {
      method: "POST",
      path: "/api/tangent/delegations",
      identityToken: ALICE,
    },
  ]);
  const stored = triggers.getStored(session.id, trigger.id);
  assert.equal(stored?.participantId, "alice@x");
  assert.equal(stored?.delegationId, "d1");
  assert.equal(JSON.stringify(trigger).includes("token-1"), false);

  const unknown = await call("POST", "", CAROL, { ...NIGHTLY, name: "other" });
  assert.equal(unknown.status, 201);
  const other = (await unknown.json()) as { trigger: { id: string } };
  assert.equal(
    triggers.getStored(session.id, other.trigger.id)?.participantId,
    undefined,
    "no live assertion, no binding",
  );
  assert.equal(backend.length, 1);
});

test("editing a bound trigger's prompt re-binds it to the editor and revokes the old grant", async () => {
  const { session, triggers, backend, call, settled } = await serveBound();
  const created = await call("POST", "", ALICE, NIGHTLY);
  const { trigger } = (await created.json()) as { trigger: { id: string } };
  backend.splice(0);

  const res = await call("PATCH", `/${trigger.id}`, BOB, { prompt: "new" });
  assert.equal(res.status, 200);
  await settled();
  assert.deepEqual(
    backend.map((c) => [c.method, c.path, c.identityToken]),
    [
      ["DELETE", "/api/tangent/delegations/d1", undefined],
      ["POST", "/api/tangent/delegations", BOB],
    ],
  );
  const stored = triggers.getStored(session.id, trigger.id);
  assert.equal(stored?.participantId, "bob@x");
  assert.equal(stored?.delegationId, "d2");
  assert.deepEqual(triggers.delegationOf(session.id, trigger.id), {
    triggerId: trigger.id,
    participantId: "bob@x",
    token: "token-2",
  });
});

test("an editor with no live assertion leaves the trigger unbound; the old grant is still revoked", async () => {
  const { session, triggers, backend, call, settled } = await serveBound();
  const created = await call("POST", "", ALICE, NIGHTLY);
  const { trigger } = (await created.json()) as { trigger: { id: string } };
  backend.splice(0);

  const res = await call("PATCH", `/${trigger.id}`, CAROL, {
    schedule: { every: "2h" },
  });
  assert.equal(res.status, 200);
  await settled();
  assert.deepEqual(
    backend.map((c) => [c.method, c.path]),
    [["DELETE", "/api/tangent/delegations/d1"]],
  );
  const stored = triggers.getStored(session.id, trigger.id);
  assert.equal(stored?.participantId, undefined);
  assert.equal(stored?.delegationId, undefined);
  assert.equal(triggers.delegationOf(session.id, trigger.id), undefined);
});

test("toggling or renaming a bound trigger keeps its binding", async () => {
  const { session, triggers, backend, call, settled } = await serveBound();
  const created = await call("POST", "", ALICE, NIGHTLY);
  const { trigger } = (await created.json()) as { trigger: { id: string } };
  backend.splice(0);

  for (const patch of [{ enabled: false }, { title: "Nightly" }]) {
    const res = await call("PATCH", `/${trigger.id}`, BOB, patch);
    assert.equal(res.status, 200);
  }
  const same = await call("PATCH", `/${trigger.id}`, BOB, {
    prompt: "check in",
    schedule: { every: "1h" },
  });
  assert.equal(same.status, 200);
  await settled();
  assert.equal(
    backend.length,
    0,
    "an edit that changes nothing is not new authorship",
  );
  const stored = triggers.getStored(session.id, trigger.id);
  assert.equal(stored?.participantId, "alice@x");
  assert.equal(stored?.delegationId, "d1");
});
