import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";

import type { SubagentInfo } from "@tangent/shared/contracts.ts";

// The internal routes check this token, which config reads at load time.
process.env.TANGENT_INTERNAL_TOKEN = "test-internal-token";

const express = (await import("express")).default;
const { createInternalAgentsRouter } = await import("./internalAgents.ts");
const { InMemorySessionStore } =
  await import("../store/inMemorySessionStore.ts");
const { connectorFor } = await import("@tangent/shared/contracts.ts");

type Args = Parameters<typeof createInternalAgentsRouter>;

const closers: (() => void)[] = [];
after(() => {
  for (const close of closers) close();
});

/** Serves the internal agents API over `store`, with `live` as the connectors' roster. */
function serve(
  store: InstanceType<typeof InMemorySessionStore>,
  live: SubagentInfo[],
): number {
  const app = express();
  app.use(
    "/internal/agents",
    createInternalAgentsRouter(
      store,
      { list: () => live } as unknown as Args[1],
      {} as Args[2],
      {} as Args[3],
      {} as Args[4],
      {} as Args[5],
    ),
  );
  const server = app.listen(0);
  closers.push(() => server.close());
  return (server.address() as AddressInfo).port;
}

test("list_subagents includes finished sub-agents nobody has dismissed", async () => {
  const store = new InMemorySessionStore();
  const session = await store.createSession({ name: "S" });
  for (const [id, status] of [
    ["sub-live", "active"],
    ["sub-done", "completed"],
    ["sub-gone", "killed"],
  ] as const) {
    await store.recordAgent(session.id, {
      id,
      role: "subagent",
      name: id,
      status,
      connector: connectorFor("pi-stdio"),
    });
  }
  await store.dismissAgent(session.id, "sub-gone");
  const live = (await store.listAgents(session.id))
    .filter(({ id }) => id === "sub-live")
    .map((agent) => ({
      id: agent.id,
      conversationId: agent.homeConversationId,
      name: agent.name,
      status: agent.status,
      connector: agent.connector,
      createdAt: agent.createdAt,
    }));
  const port = serve(store, live);

  const res = await fetch(
    `http://127.0.0.1:${port}/internal/agents/list?sessionId=${session.id}`,
    { headers: { authorization: "Bearer test-internal-token" } },
  );
  const { subagents } = (await res.json()) as {
    subagents: { id: string; status: string }[];
  };

  assert.equal(res.status, 200);
  assert.deepEqual(
    subagents.map(({ id, status }) => [id, status]),
    [
      ["sub-live", "active"],
      ["sub-done", "completed"],
    ],
  );
});
