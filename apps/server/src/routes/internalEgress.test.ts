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
  if (held.includes("alice@x")) assertions.record("alice@x", ALICE);
  if (held.includes("bob@x")) assertions.record("bob@x", BOB);

  const app = express();
  app.use(express.json());
  app.use(
    "/internal/egress",
    createInternalEgressRouter(agents, {
      runs: {
        participantsFor: () => [...participants],
        delegationFor: () => options.delegation,
      },
      assertions,
    }),
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
  };
}

/** Stands in for the backend, recording the identity header it received. */
function upstream(status = 200) {
  const seen: (string | undefined)[] = [];
  mock.method(
    globalThis,
    "fetch",
    async (_input: string | URL | Request, init?: RequestInit) => {
      seen.push(
        (init?.headers as Record<string, string>)["x-tangent-on-behalf-of"],
      );
      return new Response(JSON.stringify({ status }), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  );
  return seen;
}

const RUNS = { target: "tangle", path: "/api/pipeline_runs/" };

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

test("without a usable assertion the call runs as the instance, with no header", async () => {
  const seen = upstream();

  const expired = serve(["alice@x"], { hold: [] });
  let body = (await (
    await expired.post({ input: RUNS }, "worker-token")
  ).json()) as {
    appliedIdentity: unknown;
  };
  assert.deepEqual(body.appliedIdentity, {
    kind: "instance",
    reason: "assertion_expired",
  });

  const unknown = serve(["alice@x"]);
  body = (await (
    await unknown.post({ input: RUNS }, "stale-token")
  ).json()) as {
    appliedIdentity: unknown;
  };
  assert.deepEqual(body.appliedIdentity, {
    kind: "instance",
    reason: "unknown_caller",
  });

  const nobody = serve([]);
  body = (await (
    await nobody.post({ input: RUNS }, "worker-token")
  ).json()) as {
    appliedIdentity: unknown;
  };
  assert.deepEqual(body.appliedIdentity, {
    kind: "instance",
    reason: "no_participant",
  });
  assert.deepEqual(seen, [undefined, undefined, undefined]);
});

test("a trigger's turn forwards its delegation token", async () => {
  const { post } = serve(["alice@x"], {
    hold: [],
    delegation: { participantId: "alice@x", token: "delegation-token" },
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
