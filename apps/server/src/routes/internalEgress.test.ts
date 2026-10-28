import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, mock, test } from "node:test";

import express from "express";

import {
  AGENT_TOKEN_HEADER,
  type AgentTokenResolver,
} from "../auth/agentCaller.ts";
import { INTERNAL_TOKEN, TANGLE_TEAM_HEADER } from "../config.ts";
import { RunRegistry } from "../runs/runRegistry.ts";
import { InMemoryRunStore } from "../store/inMemoryRunStore.ts";
import { createInternalEgressRouter } from "./internalEgress.ts";

const realFetch = globalThis.fetch;
const servers: Server[] = [];

after(() => {
  for (const server of servers) server.close();
});
afterEach(() => mock.reset());

const agents: AgentTokenResolver = (token) =>
  token === "prime-token" ? { sessionId: "s1", agentId: "prime" } : undefined;

/** The internal egress route, where Prime's open Run is granted `team-a`. */
function serve(): string {
  const runs = new RunRegistry(new InMemoryRunStore());
  runs.open({
    sessionId: "s1",
    participantId: "prime",
    ingress: "reaction",
    actingTeam: "team-a",
  });

  const app = express();
  app.use(express.json());
  app.use("/internal/egress", createInternalEgressRouter(agents, runs));
  const server = app.listen(0);
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/internal/egress`;
}

/** Answers the proxied Tangle call with `status`, exposing its headers. */
function fakeTangle(status = 200): () => Record<string, string> {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    Response.json({}, { status }),
  );
  return () =>
    (fetchMock.mock.calls[0]?.arguments[1]?.headers ?? {}) as Record<
      string,
      string
    >;
}

interface EgressCall {
  input: unknown;
  init?: unknown;
  token?: string;
  actAsTeam?: boolean;
}

async function egress(
  base: string,
  { input, init = {}, token, actAsTeam }: EgressCall,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await realFetch(base, {
    method: "POST",
    headers: {
      authorization: `Bearer ${INTERNAL_TOKEN}`,
      "content-type": "application/json",
      ...(token ? { [AGENT_TOKEN_HEADER]: token } : {}),
    },
    body: JSON.stringify({ input, init, actAsTeam }),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

const SECRETS = { target: "tangle", path: "/api/secrets/" };

test("a granted request that asks goes upstream as, and reports, the team", async () => {
  const base = serve();
  const headers = fakeTangle();

  const { status, body } = await egress(base, {
    input: SECRETS,
    token: "prime-token",
    actAsTeam: true,
  });

  assert.equal(status, 200);
  assert.equal(headers()[TANGLE_TEAM_HEADER], "team-a");
  assert.equal(body.appliedTeam, "team-a");
});

test("reports a null team whenever none was applied", async () => {
  const base = serve();
  const executions = { target: "tangle", path: "/api/executions/run-1/state" };
  const cases: EgressCall[] = [
    { input: SECRETS, token: "prime-token" },
    { input: executions, token: "prime-token", actAsTeam: true },
    { input: SECRETS },
  ];

  for (const call of cases) {
    const headers = fakeTangle();
    const { body } = await egress(base, call);
    assert.equal(body.appliedTeam, null, JSON.stringify(call));
    assert.equal(headers()[TANGLE_TEAM_HEADER], undefined);
    mock.reset();
  }
});

test("asking to act as a team without a grant is a 403 that never goes upstream", async () => {
  const base = serve();
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    Response.json({}),
  );

  const { status, body } = await egress(base, {
    input: SECRETS,
    actAsTeam: true,
  });

  assert.equal(status, 403);
  assert.equal(body.error, "no Tangle team is granted for this turn");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("reports the team on an upstream refusal", async () => {
  const base = serve();
  fakeTangle(401);

  const { status, body } = await egress(base, {
    input: { target: "tangle", path: "/api/pipeline_runs/" },
    init: { method: "POST", body: {} },
    token: "prime-token",
    actAsTeam: true,
  });

  assert.equal(status, 200);
  assert.equal(body.status, 401);
  assert.equal(body.appliedTeam, "team-a");
});

test("a denied destination is a 403 without a team", async () => {
  const base = serve();

  const { status, body } = await egress(base, {
    input: { target: "tangle", path: "/api/private" },
    token: "prime-token",
    actAsTeam: true,
  });

  assert.equal(status, 403);
  assert.equal("appliedTeam" in body, false);
});

test("reports the team the caller's turn is granted", async () => {
  const base = serve();
  const grantedTeam = async (token?: string) => {
    const res = await realFetch(`${base}/granted-team`, {
      headers: {
        authorization: `Bearer ${INTERNAL_TOKEN}`,
        ...(token ? { [AGENT_TOKEN_HEADER]: token } : {}),
      },
    });
    return ((await res.json()) as { grantedTeam: unknown }).grantedTeam;
  };

  assert.equal(await grantedTeam("prime-token"), "team-a");
  assert.equal(await grantedTeam(), null);
});
