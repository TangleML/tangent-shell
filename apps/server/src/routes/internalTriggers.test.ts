import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const ROOT = mkdtempSync(path.join(tmpdir(), "internal-triggers-"));
process.env.SESSIONS_ROOT = ROOT;
process.env.TANGENT_INTERNAL_TOKEN = "internal-test-secret";

const express = (await import("express")).default;
const { AGENT_TOKEN_HEADER } = await import("../auth/agentCaller.ts");
const { IdentityAssertionCache } =
  await import("../auth/identityAssertions.ts");
const { TriggerDelegations } =
  await import("../pi/triggers/triggerDelegation.ts");
const { TriggerEngine } = await import("../pi/triggers/triggerEngine.ts");
const { TriggerManager } = await import("../pi/triggers/triggerManager.ts");
const { InMemoryTriggerDelegationStore } =
  await import("../store/inMemoryTriggerDelegationStore.ts");
const { InMemorySessionStore } =
  await import("../store/inMemorySessionStore.ts");
const { InMemoryParticipantStore } =
  await import("../store/inMemoryParticipantStore.ts");
const { createInternalTriggersRouter } = await import("./internalTriggers.ts");

import type { Server } from "socket.io";

import type { EgressResponse } from "../bundleUi/egressAllowlist.ts";
import type { ConversationRouter } from "../conversation/conversationRouter.ts";
import type { PiAgentManager } from "../pi/piAgentManager.ts";
import type { DelegationEgress } from "../pi/triggers/triggerDelegation.ts";
import type { TriggerManager as Triggers } from "../pi/triggers/triggerManager.ts";
import type { SessionStore } from "../store/sessionStore.ts";

const TOKEN = "internal-test-secret";
const SOON = Math.floor(Date.now() / 1000) + 600;

function jwt(claims: Record<string, unknown>): string {
  const segment = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `h.${segment(claims)}.sig`;
}
const ALICE = jwt({ email: "alice@x", exp: SOON });

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
  rmSync(ROOT, { recursive: true, force: true });
});

interface BackendCall {
  path: string;
  method: string | undefined;
  body: unknown;
  identityToken: string | undefined;
}

/** A real engine over the manager, so removals release delegations as deployed. */
function engineOver(
  store: SessionStore,
  triggers: Triggers,
  delegations: InstanceType<typeof TriggerDelegations>,
) {
  return new TriggerEngine(
    { to: () => ({ emit: () => undefined }) } as unknown as Server,
    store,
    {} as PiAgentManager,
    triggers,
    {} as ConversationRouter,
    undefined,
    delegations,
  );
}

/** The triggers API over a real store, manager and engine, with a fake backend. */
async function serve(options: {
  acting?: string;
  hold?: boolean;
  refuse?: boolean;
  identityHeader?: string;
}) {
  const store = new InMemorySessionStore(new InMemoryParticipantStore());
  const session = await store.createSession({ name: "S" });
  const triggers = new TriggerManager(new InMemoryTriggerDelegationStore());

  const backend: BackendCall[] = [];
  const egress: DelegationEgress = async (input, init, _caller, opts) => {
    backend.push({
      path: typeof input === "string" ? input : input.path,
      method: init?.method,
      body: init?.body,
      identityToken: opts.identityToken,
    });
    if (options.refuse) throw new Error("backend down");
    return answerFor(init?.method);
  };
  const assertions = new IdentityAssertionCache();
  if (options.hold !== false) assertions.record("alice@x", ALICE, "bearer");
  const delegations = new TriggerDelegations(
    egress,
    "/api/tangent/delegations",
    "x-tangent-on-behalf-of",
  );
  const engine = engineOver(store, triggers, delegations);
  cleanups.push(() => engine.disarm(session.id));
  const acting = { current: options.acting };

  const app = express();
  app.use(express.json());
  app.use(
    "/internal/triggers",
    createInternalTriggersRouter(
      store,
      triggers,
      engine,
      {
        resolveAgentToken: (token) =>
          token === "prime-token"
            ? { sessionId: session.id, agentId: "prime" }
            : undefined,
      },
      {
        runs: { audienceFor: () => acting.current },
        delegations,
        assertions,
        identityHeader: options.identityHeader,
      },
    ),
  );
  const server = app.listen(0);
  cleanups.push(() => server.close());
  const post = poster((server.address() as AddressInfo).port, session.id);
  return { session, triggers, backend, post, acting };
}

/** Lets the engine's best-effort revoke land before the backend log is read. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

/** Posts JSON to the served API as a Pi child, optionally naming itself. */
function poster(port: number, sessionId: string) {
  const base = `http://127.0.0.1:${port}/internal/triggers`;
  return (route: string, body: unknown, agentToken?: string) =>
    fetch(`${base}${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
        ...(agentToken ? { [AGENT_TOKEN_HEADER]: agentToken } : {}),
      },
      body: JSON.stringify({ sessionId, ...(body as object) }),
    });
}

/** What the fake backend answers: a 204 to a revoke, an issued delegation otherwise. */
function answerFor(method: string | undefined): EgressResponse {
  if (method === "DELETE") return { ok: true, status: 204, headers: {} };
  return {
    ok: true,
    status: 201,
    headers: {},
    json: { id: "d1", token: "delegation-token" },
  };
}

const NIGHTLY = {
  name: "nightly",
  kind: "schedule",
  prompt: "check in",
  schedule: { every: "1h" },
  target: "prime",
};

test("creating a trigger during a participant's turn registers a delegation", async () => {
  const { session, triggers, backend, post } = await serve({
    acting: "alice@x",
  });

  const res = await post("/create", NIGHTLY, "prime-token");
  assert.equal(res.status, 200);
  const { trigger } = (await res.json()) as { trigger: { id: string } };

  assert.deepEqual(backend, [
    {
      path: "/api/tangent/delegations",
      method: "POST",
      body: { scope: `trigger:${trigger.id}` },
      identityToken: ALICE,
    },
  ]);
  const stored = triggers.getStored(session.id, trigger.id);
  assert.equal(stored?.participantId, "alice@x");
  assert.equal(stored?.delegationId, "d1");
  assert.deepEqual(triggers.delegationOf(session.id, trigger.id), {
    triggerId: trigger.id,
    participantId: "alice@x",
    token: "delegation-token",
  });
  assert.equal(JSON.stringify(trigger).includes("delegation-token"), false);
});

test("a failed registration still creates the trigger, bound to the person", async () => {
  const { session, triggers, post } = await serve({
    acting: "alice@x",
    refuse: true,
  });

  const res = await post("/create", NIGHTLY, "prime-token");
  assert.equal(res.status, 200);
  const { trigger } = (await res.json()) as { trigger: { id: string } };
  const stored = triggers.getStored(session.id, trigger.id);
  assert.equal(stored?.participantId, "alice@x");
  assert.equal(stored?.delegationId, undefined);
  assert.equal(triggers.delegationOf(session.id, trigger.id), undefined);
});

test("no live assertion, or no identified caller, means no delegation call", async () => {
  const expired = await serve({ acting: "alice@x", hold: false });
  const res = await expired.post("/create", NIGHTLY, "prime-token");
  const { trigger } = (await res.json()) as { trigger: { id: string } };
  assert.deepEqual(expired.backend, []);
  assert.equal(
    expired.triggers.getStored(expired.session.id, trigger.id)?.participantId,
    "alice@x",
  );

  const anonymous = await serve({ acting: "alice@x" });
  const plain = await anonymous.post("/create", NIGHTLY);
  const created = (await plain.json()) as { trigger: { id: string } };
  assert.deepEqual(anonymous.backend, []);
  assert.equal(
    anonymous.triggers.getStored(anonymous.session.id, created.trigger.id)
      ?.participantId,
    undefined,
  );
});

test("deleting a trigger revokes its delegation exactly once", async () => {
  const { backend, post } = await serve({ acting: "alice@x" });
  await post("/create", NIGHTLY, "prime-token");

  const res = await post("/delete", { name: "nightly" }, "prime-token");
  assert.equal(res.status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(backend.length, 2);
  assert.equal(backend[1].path, "/api/tangent/delegations/d1");
  assert.equal(backend[1].method, "DELETE");
});

test("once identity forwarding is configured, every trigger call must name its agent", async () => {
  const { triggers, session, post } = await serve({
    acting: "alice@x",
    identityHeader: "x-tangent-on-behalf-of",
  });

  const anonymous = await post("/create", NIGHTLY);
  assert.equal(anonymous.status, 403);
  assert.equal(
    ((await anonymous.json()) as { code: string }).code,
    "caller_required",
  );
  assert.deepEqual(triggers.list(session.id), []);

  const named = await post("/create", NIGHTLY, "prime-token");
  assert.equal(named.status, 200);
  const listed = await post("/list", {}, "prime-token");
  assert.notEqual(listed.status, 403);
});

test("a call naming a session other than its token's is refused", async () => {
  const { post } = await serve({ acting: "alice@x" });

  const forged = await post(
    "/create",
    { ...NIGHTLY, sessionId: "another-session" },
    "prime-token",
  );
  assert.equal(forged.status, 403);
  assert.equal(
    ((await forged.json()) as { code: string }).code,
    "agent_mismatch",
  );
});

test("editing what a bound trigger does revokes its grant and binds it to the editor's turn", async () => {
  const { session, triggers, backend, post } = await serve({
    acting: "alice@x",
  });
  const created = await post("/create", NIGHTLY, "prime-token");
  const { trigger } = (await created.json()) as { trigger: { id: string } };
  backend.splice(0);

  const toggled = await post(
    "/update",
    { name: "nightly", enabled: false },
    "prime-token",
  );
  assert.equal(toggled.status, 200);
  await settled();
  assert.equal(backend.length, 0, "toggling keeps the binding");
  assert.equal(triggers.getStored(session.id, trigger.id)?.delegationId, "d1");

  const edited = await post(
    "/update",
    { name: "nightly", prompt: "something else" },
    "prime-token",
  );
  assert.equal(edited.status, 200);
  await settled();
  assert.deepEqual(
    backend.map((call) => [call.method, call.path]),
    [
      ["DELETE", "/api/tangent/delegations/d1"],
      ["POST", "/api/tangent/delegations"],
    ],
  );
  assert.equal(
    backend[1].body && (backend[1].body as { scope: string }).scope,
    `trigger:${trigger.id}`,
  );
  const stored = triggers.getStored(session.id, trigger.id);
  assert.equal(stored?.participantId, "alice@x");
  assert.equal(stored?.delegationId, "d1");
});

test("an edit by an agent whose turn has nobody behind it leaves the trigger unbound", async () => {
  const { session, triggers, backend, post, acting } = await serve({
    acting: "alice@x",
  });
  const created = await post("/create", NIGHTLY, "prime-token");
  const { trigger } = (await created.json()) as { trigger: { id: string } };
  backend.splice(0);

  acting.current = undefined;
  const res = await post(
    "/update",
    { name: "nightly", schedule: { every: "2h" } },
    "prime-token",
  );
  assert.equal(res.status, 200);
  await settled();
  assert.deepEqual(
    backend.map((call) => [call.method, call.path]),
    [["DELETE", "/api/tangent/delegations/d1"]],
  );
  const after = triggers.getStored(session.id, trigger.id);
  assert.equal(after?.participantId, undefined);
  assert.equal(after?.delegationId, undefined);
  assert.equal(triggers.delegationOf(session.id, trigger.id), undefined);
});
