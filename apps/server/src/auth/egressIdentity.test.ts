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
  ParticipantNotInTurnError,
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

/** Identity deps over a fixed set, with Alice and Bob holding live assertions. */
function deps(
  participants: string[],
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
      participantsFor: () => [...participants],
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

test("the acting default is the most recent member, carrying their assertion", () => {
  const chosen = chooseEgressIdentity(
    deps(["alice@x", "bob@x"]),
    WORKER,
    undefined,
  );
  assert.deepEqual(chosen.applied, { kind: "participant", id: "bob@x" });
  assert.equal(chosen.token, BOB);
});

test("onBehalfOf picks another member of the set, and refuses a non-member", () => {
  const chosen = chooseEgressIdentity(
    deps(["alice@x", "bob@x"]),
    WORKER,
    "alice@x",
  );
  assert.deepEqual(chosen.applied, { kind: "participant", id: "alice@x" });
  assert.equal(chosen.token, ALICE);

  assert.throws(
    () => chooseEgressIdentity(deps(["alice@x", "bob@x"]), WORKER, "mallory@x"),
    (err: unknown) =>
      err instanceof ParticipantNotInTurnError &&
      err.code === "participant_not_in_turn",
  );
});

test("an unidentified caller is refused once forwarding is configured", () => {
  for (const onBehalfOf of [undefined, "alice@x"]) {
    assert.throws(
      () => chooseEgressIdentity(deps(["alice@x"]), undefined, onBehalfOf),
      (err: unknown) =>
        err instanceof CallerRequiredError && err.code === "caller_required",
    );
  }
  assert.deepEqual(
    chooseEgressIdentity(
      { ...deps(["alice@x"]), identityHeader: "" },
      undefined,
      undefined,
    ).applied,
    { kind: "instance", reason: "not_configured" },
  );
});

test("the instance stands in only when forwarding is off or nobody is behind the turn", () => {
  assert.deepEqual(
    chooseEgressIdentity(
      { ...deps(["alice@x"]), identityHeader: "" },
      WORKER,
      undefined,
    ).applied,
    { kind: "instance", reason: "not_configured" },
  );
  assert.deepEqual(chooseEgressIdentity(deps([]), WORKER, undefined).applied, {
    kind: "instance",
    reason: "no_participant",
  });
});

test("a participant whose assertion expired is a refusal, not a fall-back to the instance", () => {
  assert.throws(
    () =>
      chooseEgressIdentity(
        deps(["alice@x"], { expired: ["alice@x"] }),
        WORKER,
        undefined,
      ),
    (err: unknown) =>
      err instanceof ParticipantAssertionExpiredError &&
      err.code === "participant_assertion_expired",
  );
  assert.throws(
    () =>
      chooseEgressIdentity(
        deps(["alice@x", "bob@x"], { expired: ["alice@x"] }),
        WORKER,
        "alice@x",
      ),
    ParticipantAssertionExpiredError,
    "naming an expired member is refused too",
  );
  assert.equal(
    chooseEgressIdentity(
      deps(["alice@x", "bob@x"], { expired: ["alice@x"] }),
      WORKER,
      undefined,
    ).token,
    BOB,
    "the acting default is judged on its own assertion",
  );
});

test("a turn opened by a trigger carries the delegation token for its creator", () => {
  const delegated = deps(["alice@x"], {
    expired: ["alice@x"],
    delegation: {
      triggerId: "t1",
      participantId: "alice@x",
      token: "delegation-token",
    },
  });
  const chosen = chooseEgressIdentity(delegated, WORKER, undefined);
  assert.deepEqual(chosen.applied, { kind: "participant", id: "alice@x" });
  assert.equal(chosen.token, "delegation-token");

  // A human who joined the trigger's turn acts under their own assertion.
  const joined = deps(["alice@x", "bob@x"], {
    delegation: {
      triggerId: "t1",
      participantId: "alice@x",
      token: "delegation-token",
    },
  });
  assert.equal(chooseEgressIdentity(joined, WORKER, undefined).token, BOB);
});

test("describeTurnIdentity lists the set with each live assertion's expiry", () => {
  const described = describeTurnIdentity(
    deps(["alice@x", "bob@x", "carol@x"]),
    WORKER,
  );
  assert.equal(described.acting, "carol@x");
  assert.deepEqual(
    described.participants.map((p) => p.id),
    ["alice@x", "bob@x", "carol@x"],
  );
  assert.equal(
    described.participants[0].assertionExpiresAt,
    new Date(SOON * 1000).toISOString(),
  );
  assert.equal(described.participants[2].assertionExpiresAt, undefined);
  assert.deepEqual(describeTurnIdentity(deps(["alice@x"]), undefined), {
    participants: [],
    acting: null,
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
