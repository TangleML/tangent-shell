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
const { TriggerManager } = await import("../pi/triggers/triggerManager.ts");
const { InMemorySessionStore } =
  await import("../store/inMemorySessionStore.ts");
const { InMemoryParticipantStore } =
  await import("../store/inMemoryParticipantStore.ts");
const { createInternalTriggersRouter } = await import("./internalTriggers.ts");

import type { EgressResponse } from "../bundleUi/egressAllowlist.ts";
import type { DelegationEgress } from "../pi/triggers/triggerDelegation.ts";
import type { TriggerEngine } from "../pi/triggers/triggerEngine.ts";

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

/** The triggers API over a real store and manager, with a fake backend. */
async function serve(options: {
  acting?: string;
  hold?: boolean;
  refuse?: boolean;
}) {
  const store = new InMemorySessionStore(new InMemoryParticipantStore());
  const session = await store.createSession({ name: "S" });
  const triggers = new TriggerManager();
  const engine = {
    provision: async () => undefined,
    afterChange: () => undefined,
  } as unknown as TriggerEngine;

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
  if (options.hold !== false) assertions.record("alice@x", ALICE);

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
        runs: { audienceFor: () => options.acting },
        delegations: new TriggerDelegations(egress, "/api/tangent/delegations"),
        assertions,
      },
    ),
  );
  const server = app.listen(0);
  cleanups.push(() => server.close());
  const post = poster((server.address() as AddressInfo).port, session.id);
  return { session, triggers, backend, post };
}

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
  assert.equal(stored?.delegationToken, "delegation-token");
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
  assert.equal(stored?.delegationToken, undefined);
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

test("deleting a trigger revokes its delegation", async () => {
  const { backend, post } = await serve({ acting: "alice@x" });
  await post("/create", NIGHTLY, "prime-token");

  const res = await post("/delete", { name: "nightly" }, "prime-token");
  assert.equal(res.status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(backend.length, 2);
  assert.equal(backend[1].path, "/api/tangent/delegations/d1");
  assert.equal(backend[1].method, "DELETE");
});
