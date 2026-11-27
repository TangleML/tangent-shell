import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, mock, test } from "node:test";

process.env.TANGENT_INTERNAL_TOKEN = "internal-test-secret";
process.env.EGRESS_IDENTITY_HEADER = "x-tangent-on-behalf-of";

const express = (await import("express")).default;
const { AGENT_TOKEN_HEADER } = await import("../auth/agentCaller.ts");
const { IdentityAssertionCache } =
  await import("../auth/identityAssertions.ts");
const { createInternalEgressRouter } = await import("./internalEgress.ts");

import type { AgentCallerResolver } from "../auth/agentCaller.ts";
import type { RunDelegation } from "../runs/runRegistry.ts";

const TOKEN = "internal-test-secret";
const SOON = Math.floor(Date.now() / 1000) + 600;

// The test client keeps the real fetch: the upstream stand-in below replaces
// the global one, and must only ever see the server's outbound call.
const http = globalThis.fetch;

function jwt(claims: Record<string, unknown>): string {
  const segment = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `h.${segment(claims)}.sig`;
}
const ALICE = jwt({ email: "alice@x", exp: SOON });
const BOB = jwt({ email: "bob@x", exp: SOON });

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
});
afterEach(() => mock.reset());

interface Served {
  post: (body: unknown, agentToken?: string) => Promise<Response>;
  identity: (agentToken?: string) => Promise<Response>;
  assertions: InstanceType<typeof IdentityAssertionCache>;
  lapsed: { sessionId: string; delegation: RunDelegation }[];
}

/** Serves the egress route for one live agent whose turn has `participants`. */
function serve(
  participants: string[],
  options: { delegation?: RunDelegation; hold?: string[] } = {},
): Served {
  const agents: AgentCallerResolver = {
    resolveAgentToken: (token) =>
      token === "worker-token"
        ? { sessionId: "s1", agentId: "worker" }
        : undefined,
  };
  const assertions = new IdentityAssertionCache();
  const held = options.hold ?? ["alice@x", "bob@x"];
  if (held.includes("alice@x")) assertions.record("alice@x", ALICE, "bearer");
  if (held.includes("bob@x")) assertions.record("bob@x", BOB, "bearer");

  const lapsed: Served["lapsed"] = [];
  const app = express();
  app.use(express.json());
  app.use(
    "/internal/egress",
    createInternalEgressRouter(
      agents,
      {
        runs: {
          participantsFor: () => [...participants],
          delegationFor: () => options.delegation,
        },
        assertions,
      },
      async (sessionId, delegation) => {
        lapsed.push({ sessionId, delegation });
      },
    ),
  );
  const server = app.listen(0);
  cleanups.push(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/egress`;
  const headers = (agentToken?: string) => ({
    "content-type": "application/json",
    authorization: `Bearer ${TOKEN}`,
    ...(agentToken ? { [AGENT_TOKEN_HEADER]: agentToken } : {}),
  });
  return {
    post: (body, agentToken) =>
      http(base, {
        method: "POST",
        headers: headers(agentToken),
        body: JSON.stringify(body),
      }),
    identity: (agentToken) =>
      http(`${base}/identity`, { headers: headers(agentToken) }),
    assertions,
    lapsed,
  };
}

/** Stands in for the backend, recording the identity header it received. */
function upstream(status = 200, body: unknown = { status }) {
  const seen: (string | undefined)[] = [];
  mock.method(
    globalThis,
    "fetch",
    async (_input: string | URL | Request, init?: RequestInit) => {
      seen.push(
        (init?.headers as Record<string, string>)["x-tangent-on-behalf-of"],
      );
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  );
  return seen;
}

const RUNS = { target: "tangle", path: "/api/pipeline_runs/" };
const DELEGATION: RunDelegation = {
  triggerId: "t1",
  participantId: "alice@x",
  token: "delegation-token",
};

test("a known agent's call runs as the acting participant, and says so", async () => {
  const { post } = serve(["alice@x", "bob@x"]);
  const seen = upstream();

  const res = await post({ input: RUNS }, "worker-token");
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    appliedIdentity: unknown;
    status: number;
  };
  assert.deepEqual(body.appliedIdentity, { kind: "participant", id: "bob@x" });
  assert.deepEqual(seen, [BOB]);
});

test("onBehalfOf must name a member of the turn", async () => {
  const { post } = serve(["alice@x", "bob@x"]);
  const seen = upstream();

  const alice = await post(
    { input: RUNS, onBehalfOf: "alice@x" },
    "worker-token",
  );
  assert.deepEqual(
    ((await alice.json()) as { appliedIdentity: unknown }).appliedIdentity,
    { kind: "participant", id: "alice@x" },
  );
  assert.deepEqual(seen, [ALICE]);

  const mallory = await post(
    { input: RUNS, onBehalfOf: "mallory@x" },
    "worker-token",
  );
  assert.equal(mallory.status, 403);
  assert.equal(
    ((await mallory.json()) as { code: string }).code,
    "participant_not_in_turn",
  );
  assert.equal(seen.length, 1, "a refused call never reaches the backend");
});

test("an expired assertion refuses the call; only a turn with nobody behind it runs as the instance", async () => {
  const seen = upstream();

  const expired = serve(["alice@x"], { hold: [] });
  const refused = await expired.post({ input: RUNS }, "worker-token");
  assert.equal(refused.status, 403);
  assert.equal(
    ((await refused.json()) as { code: string }).code,
    "participant_assertion_expired",
  );

  const nobody = serve([]);
  const body = (await (
    await nobody.post({ input: RUNS }, "worker-token")
  ).json()) as {
    appliedIdentity: unknown;
  };
  assert.deepEqual(body.appliedIdentity, {
    kind: "instance",
    reason: "no_participant",
  });
  assert.deepEqual(
    seen,
    [undefined],
    "a refused call never reaches the backend",
  );
});

test("a call that does not identify its agent is refused, never run as the instance", async () => {
  const seen = upstream();
  const { post } = serve(["alice@x"]);

  const anonymous = await post({ input: RUNS });
  assert.equal(anonymous.status, 403);
  assert.equal(
    ((await anonymous.json()) as { code: string }).code,
    "caller_required",
  );

  const stale = await post({ input: RUNS }, "stale-token");
  assert.equal(stale.status, 401);
  assert.equal(
    ((await stale.json()) as { code: string }).code,
    "agent_unknown",
  );
  assert.deepEqual(seen, []);
});

test("a trigger's turn forwards its delegation token", async () => {
  const { post } = serve(["alice@x"], {
    hold: [],
    delegation: DELEGATION,
  });
  const seen = upstream();
  const body = (await (await post({ input: RUNS }, "worker-token")).json()) as {
    appliedIdentity: unknown;
  };
  assert.deepEqual(body.appliedIdentity, {
    kind: "participant",
    id: "alice@x",
  });
  assert.deepEqual(seen, ["delegation-token"]);
});

test("an upstream 401 keeps its status in the envelope, with the applied identity", async () => {
  const { post } = serve(["alice@x"]);
  upstream(401);
  const res = await post({ input: RUNS }, "worker-token");
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    ok: boolean;
    status: number;
    appliedIdentity: unknown;
  };
  assert.equal(body.ok, false);
  assert.equal(body.status, 401);
  assert.deepEqual(body.appliedIdentity, {
    kind: "participant",
    id: "alice@x",
  });
});

test("an upstream 401 evicts the assertion it refused, and only that one", async () => {
  const { post, assertions } = serve(["alice@x", "bob@x"]);
  upstream(401);

  const res = await post({ input: RUNS }, "worker-token");
  assert.equal(((await res.json()) as { status: number }).status, 401);
  assert.equal(assertions.get("bob@x"), undefined);
  assert.ok(assertions.get("alice@x"));

  const next = await post({ input: RUNS }, "worker-token");
  assert.equal(next.status, 403);
  assert.equal(
    ((await next.json()) as { code: string }).code,
    "participant_assertion_expired",
  );
});

test("an upstream 401 whose identity assertion error says the delegation lapsed hands it over", async () => {
  const { post, lapsed } = serve(["alice@x"], {
    hold: [],
    delegation: DELEGATION,
  });

  const expired = { detail: "Identity assertion error: delegation expired" };
  upstream(401, expired);
  const res = await post({ input: RUNS }, "worker-token");
  const body = (await res.json()) as { status: number; json: unknown };
  assert.equal(body.status, 401);
  assert.deepEqual(body.json, expired);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(lapsed, [{ sessionId: "s1", delegation: DELEGATION }]);

  upstream(401, {
    detail: "Identity assertion error: delegation has been revoked",
  });
  await post({ input: RUNS }, "worker-token");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lapsed.length, 2);
});

test("an upstream 401 with any other reason, wording or shape drops no delegation", async () => {
  const { post, lapsed } = serve(["alice@x"], {
    hold: [],
    delegation: DELEGATION,
  });
  const refusals: unknown[] = [
    { detail: "Identity assertion error: token signature invalid" },
    { detail: "Identity assertion error: Delegation expired" },
    { detail: "identity assertion error: delegation expired" },
    { detail: "Identity assertion error: delegation expired." },
    { detail: "Delegation expired" },
    { detail: "the delegation has been revoked" },
    { error: "Identity assertion error: delegation expired" },
    "Identity assertion error: delegation expired",
  ];

  for (const refusal of refusals) {
    upstream(401, refusal);
    await post({ input: RUNS }, "worker-token");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(lapsed.length, 0, JSON.stringify(refusal));
  }
});

test("proxy errors carry stable codes", async () => {
  const { post } = serve(["alice@x"]);

  const denied = await post(
    { input: "https://elsewhere.example/api" },
    "worker-token",
  );
  assert.equal(denied.status, 403);
  assert.equal(
    ((await denied.json()) as { code: string }).code,
    "egress_denied",
  );

  mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed");
  });
  const unreachable = await post({ input: RUNS }, "worker-token");
  assert.equal(unreachable.status, 502);
  assert.equal(
    ((await unreachable.json()) as { code: string }).code,
    "upstream_unreachable",
  );
});

test("GET /identity describes the caller's turn, or nobody's", async () => {
  const { identity } = serve(["alice@x", "carol@x"], { hold: ["alice@x"] });

  const known = (await (await identity("worker-token")).json()) as {
    participants: { id: string; assertionExpiresAt?: string }[];
    acting: string | null;
  };
  assert.equal(known.acting, "carol@x");
  assert.deepEqual(known.participants, [
    { id: "alice@x", assertionExpiresAt: new Date(SOON * 1000).toISOString() },
    { id: "carol@x" },
  ]);

  assert.deepEqual(await (await identity()).json(), {
    participants: [],
    acting: null,
  });
});
