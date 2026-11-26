import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

// The identity header and delegation path are read once when `config.ts`
// loads, so both are pinned before the module graph is imported.
process.env.EGRESS_IDENTITY_HEADER = "x-tangent-on-behalf-of";
process.env.EGRESS_DELEGATION_PATH = "/api/tangent/delegations";

const { TANGLE_API_URL } = await import("../config.ts");
const { EgressDeniedError, resolveEgress } =
  await import("../bundleUi/egressAllowlist.ts");
const { IdentityAssertionCache } = await import("./identityAssertions.ts");
const {
  CallerRequiredError,
  chooseEgressIdentity,
  describeTurnIdentity,
  ParticipantAssertionExpiredError,
} = await import("./egressIdentity.ts");

import type { RunDelegation } from "../runs/runRegistry.ts";
import type { AgentCaller } from "./agentCaller.ts";
import type { EgressIdentityDeps } from "./egressIdentity.ts";

const WORKER: AgentCaller = { sessionId: "s1", agentId: "worker" };

function jwt(claims: Record<string, unknown>): string {
  const segment = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `h.${segment(claims)}.sig`;
}

const SOON = Math.floor(Date.now() / 1000) + 600;
const ALICE = jwt({ email: "alice@x", exp: SOON });
const BOB = jwt({ email: "bob@x", exp: SOON + 60 });

/** Identity deps for a turn `participant` stands behind; Alice and Bob hold live assertions. */
function deps(
  participant: string | undefined,
  options: {
    delegation?: RunDelegation;
    expired?: string[];
  } = {},
): EgressIdentityDeps {
  const assertions = new IdentityAssertionCache();
  if (!options.expired?.includes("alice@x"))
    assertions.record("alice@x", ALICE, "bearer");
  if (!options.expired?.includes("bob@x")) {
    assertions.record("bob@x", BOB, "bearer");
  }
  return {
    runs: {
      audienceFor: () => participant,
      delegationFor: () => options.delegation,
    },
    assertions,
  };
}

/** Captures the headers the upstream would have received. */
function captureFetch(status = 200) {
  const seen: Record<string, string>[] = [];
  mock.method(
    globalThis,
    "fetch",
    async (_input: string | URL | Request, init?: RequestInit) => {
      seen.push({ ...(init?.headers as Record<string, string>) });
      return new Response(JSON.stringify({ ok: status < 400 }), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  );
  return seen;
}

afterEach(() => mock.reset());

test("the human behind the turn is carried with their assertion", () => {
  const chosen = chooseEgressIdentity(deps("bob@x"), WORKER);
  assert.deepEqual(chosen.applied, { kind: "participant", id: "bob@x" });
  assert.equal(chosen.token, BOB);
});

test("an unidentified caller is refused once forwarding is configured", () => {
  assert.throws(
    () => chooseEgressIdentity(deps("alice@x"), undefined),
    (err: unknown) =>
      err instanceof CallerRequiredError && err.code === "caller_required",
  );
  assert.deepEqual(
    chooseEgressIdentity({ ...deps("alice@x"), identityHeader: "" }, undefined)
      .applied,
    { kind: "instance", reason: "not_configured" },
  );
});

test("the instance stands in only when forwarding is off or nobody is behind the turn", () => {
  assert.deepEqual(
    chooseEgressIdentity({ ...deps("alice@x"), identityHeader: "" }, WORKER)
      .applied,
    { kind: "instance", reason: "not_configured" },
  );
  assert.deepEqual(chooseEgressIdentity(deps(undefined), WORKER).applied, {
    kind: "instance",
    reason: "no_participant",
  });
});

test("a participant whose assertion expired is a refusal, not a fall-back to the instance", () => {
  assert.throws(
    () =>
      chooseEgressIdentity(deps("alice@x", { expired: ["alice@x"] }), WORKER),
    (err: unknown) =>
      err instanceof ParticipantAssertionExpiredError &&
      err.code === "participant_assertion_expired",
  );
});

test("a turn opened by a trigger carries the delegation token for its creator", () => {
  const delegation = {
    triggerId: "t1",
    participantId: "alice@x",
    token: "delegation-token",
  };
  const delegated = deps("alice@x", { expired: ["alice@x"], delegation });
  const chosen = chooseEgressIdentity(delegated, WORKER);
  assert.deepEqual(chosen.applied, { kind: "participant", id: "alice@x" });
  assert.equal(chosen.token, "delegation-token");

  // A human who took over the trigger's turn acts under their own assertion.
  const takenOver = deps("bob@x", { delegation });
  assert.equal(chooseEgressIdentity(takenOver, WORKER).token, BOB);
});

test("describeTurnIdentity names the human behind the turn with their assertion's expiry", () => {
  assert.deepEqual(describeTurnIdentity(deps("alice@x"), WORKER), {
    participant: {
      id: "alice@x",
      assertionExpiresAt: new Date(SOON * 1000).toISOString(),
    },
  });
  assert.deepEqual(describeTurnIdentity(deps("carol@x"), WORKER), {
    participant: { id: "carol@x" },
  });
  assert.deepEqual(describeTurnIdentity(deps(undefined), WORKER), {
    participant: null,
  });
  assert.deepEqual(describeTurnIdentity(deps("alice@x"), undefined), {
    participant: null,
  });
});

test("the resolver forwards the identity header for an agent, after dropping any caller copy", async () => {
  const seen = captureFetch();
  await resolveEgress(
    { target: "tangle", path: "/api/pipeline_runs/" },
    { headers: { "X-Tangent-On-Behalf-Of": "forged", accept: "text/plain" } },
    "agent",
    { identityToken: "real-token" },
  );
  assert.equal(seen[0]["x-tangent-on-behalf-of"], "real-token");
  assert.equal(seen[0].accept, "text/plain");

  await resolveEgress(
    { target: "tangle", path: "/api/pipeline_runs/" },
    { headers: { "x-tangent-on-behalf-of": "forged" } },
    "agent",
  );
  assert.equal("x-tangent-on-behalf-of" in seen[1], false);
});

test("a UI caller never forwards an identity, even when handed a token", async () => {
  const seen = captureFetch();
  await resolveEgress(
    { target: "tangle", path: "/api/pipeline_runs/" },
    {},
    "ui",
    { identityToken: "real-token" },
  );
  assert.equal("x-tangent-on-behalf-of" in seen[0], false);
});

test("the delegation path is open to the server alone, for POST and DELETE <id>", async () => {
  const seen = captureFetch(201);
  const path = "/api/tangent/delegations";
  await resolveEgress(
    { target: "tangle", path },
    { method: "POST", body: { scope: "trigger:t1" } },
    "server",
    { identityToken: ALICE },
  );
  assert.equal(seen[0]["x-tangent-on-behalf-of"], ALICE);
  await resolveEgress(
    { target: "tangle", path: `${path}/d1` },
    { method: "DELETE" },
    "server",
  );
  assert.equal(seen.length, 2);

  for (const caller of ["agent", "ui"] as const) {
    await assert.rejects(
      resolveEgress(
        `${TANGLE_API_URL}${path}`,
        { method: "POST", body: {} },
        caller,
      ),
      EgressDeniedError,
    );
  }
  await assert.rejects(
    resolveEgress(
      { target: "tangle", path: `${path}/d1/extra` },
      { method: "DELETE" },
      "server",
    ),
    EgressDeniedError,
  );
});
