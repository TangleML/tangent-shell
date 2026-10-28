import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, mock, test } from "node:test";

import express from "express";

import { AGENT_TOKEN_HEADER } from "../auth/agentCaller.ts";
import { TANGLE_TEAM_HEADER } from "../config.ts";
import type { AgentBundleStore } from "../store/agentBundleStore.ts";
import { createAgentBundlesRouter } from "./agentBundles.ts";

const realFetch = globalThis.fetch;
const servers: Server[] = [];

after(() => {
  for (const server of servers) server.close();
});
afterEach(() => mock.reset());

function serve(): string {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/agent-bundles",
    createAgentBundlesRouter({} as unknown as AgentBundleStore),
  );
  const server = app.listen(0);
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/api/agent-bundles`;
}

test("the bundle-UI egress response never carries a team", async () => {
  const base = serve();
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    Response.json({}),
  );

  const res = await realFetch(`${base}/ui-egress`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [AGENT_TOKEN_HEADER]: "prime-token",
    },
    body: JSON.stringify({
      input: { target: "tangle", path: "/api/secrets/" },
      init: { headers: { [TANGLE_TEAM_HEADER]: "team-x" } },
    }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  const upstream = fetchMock.mock.calls[0]?.arguments[1]?.headers as Record<
    string,
    string
  >;

  assert.equal(res.status, 200);
  assert.equal("appliedTeam" in body, false);
  assert.equal(upstream[TANGLE_TEAM_HEADER], undefined);
});
