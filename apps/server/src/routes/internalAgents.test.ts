import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir and pin the internal token before
// importing modules that read config at load time.
const ROOT = mkdtempSync(path.join(tmpdir(), "internal-agents-"));
process.env.SESSIONS_ROOT = ROOT;
process.env.TANGENT_INTERNAL_TOKEN = "internal-test-secret";

const express = (await import("express")).default;
const { createInternalAgentsRouter } = await import("./internalAgents.ts");
const { orchestratorIdentity } =
  await import("../conversation/participantRegistry.ts");
const { ReactorRegistry } = await import("../conversation/reactorRegistry.ts");
const { InMemoryReactorStore } =
  await import("../store/inMemoryReactorStore.ts");
const { InMemorySessionStore } =
  await import("../store/inMemorySessionStore.ts");
const { InMemoryParticipantStore } =
  await import("../store/inMemoryParticipantStore.ts");

import { connectorFor, type SubagentInfo } from "@tangent/shared/contracts.ts";

import type { A2aPeerGateway } from "../a2a/a2aPeerGateway.ts";
import {
  AGENT_TOKEN_HEADER,
  type AgentCallerResolver,
} from "../auth/agentCaller.ts";
import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import type { ConversationRouter } from "../conversation/conversationRouter.ts";
import type { ParticipantService } from "../conversation/participantService.ts";
import type { SpawnedSubagent } from "../pi/piAgentManager.ts";
import type { RunRegistry } from "../runs/runRegistry.ts";

type Args = Parameters<typeof createInternalAgentsRouter>;

const TOKEN = "internal-test-secret";

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
  rmSync(ROOT, { recursive: true, force: true });
});

/** The sub-agent a stubbed spawner hands back, in a fresh Conversation. */
function spawned(id: string, conversationId: string): SpawnedSubagent {
  const info: SubagentInfo = {
    id,
    conversationId,
    name: id,
    status: "active",
    connector: connectorFor("pi-stdio"),
    createdAt: new Date().toISOString(),
  };
  return { info, tools: [], systemPrompt: "", autoRelayToPrime: true };
}

/** A running internal-agents API over in-memory stores and stubbed connectors. */
async function serve(
  agents?: AgentCallerResolver,
  identitySet: readonly string[] = [],
) {
  const store = new InMemorySessionStore(new InMemoryParticipantStore());
  const reactors = new ReactorRegistry(new InMemoryReactorStore());

  const killed: string[] = [];
  const connectors = {
    spawner: () => ({
      spawn: (_sessionId: string, request: { name: string }) =>
        spawned(request.name, `conv-${request.name}`),
    }),
    resolve: (_sessionId: string, agentId: string) => ({
      kill: () => killed.push(agentId),
    }),
  } as unknown as ConnectorRegistry;

  const conversations = {
    postToConversation: async () => ({ woke: [], refused: [] }),
  } as unknown as ConversationRouter;

  const seeded: { agentId: string; participants: readonly string[] }[] = [];
  const runs = {
    participantsFor: () => [...identitySet],
    recordAudience: (
      _sessionId: string,
      agentId: string,
      inherited: readonly string[],
    ) => seeded.push({ agentId, participants: inherited }),
  } as unknown as RunRegistry;

  const a2a = {} as unknown as A2aPeerGateway;
  const participants = {} as unknown as ParticipantService;

  const app = express();
  app.use(express.json());
  app.use(
    "/internal/agents",
    createInternalAgentsRouter(
      store,
      connectors,
      conversations,
      a2a,
      participants,
      runs,
      reactors,
      undefined,
      undefined,
      agents,
    ),
  );

  const server = app.listen(0);
  cleanups.push(() => server.close());
  const { port } = server.address() as AddressInfo;
  return { store, reactors, killed, seeded, post: poster(port) };
}

/** Posts JSON to the served API as a Pi child, optionally naming itself. */
function poster(port: number) {
  const base = `http://127.0.0.1:${port}/internal/agents`;
  return (route: string, body: unknown, agentToken?: string) =>
    fetch(`${base}${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
        ...(agentToken ? { [AGENT_TOKEN_HEADER]: agentToken } : {}),
      },
      body: JSON.stringify(body),
    });
}

/** Serves the internal agents API over `store`, with `live` as the connectors' roster. */
function serveList(
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
      {} as Args[6],
    ),
  );
  const server = app.listen(0);
  cleanups.push(() => server.close());
  return (server.address() as AddressInfo).port;
}

test("spawning installs a supervise reactor for the orchestrator", async () => {
  const { store, reactors, post } = await serve();
  const session = await store.createSession({ name: "S" });
  const { orchestratorId, homeConversationId } = await orchestratorIdentity(
    store,
    session.id,
  );

  const res = await post("/spawn", { sessionId: session.id, name: "worker" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { subagent: { conversationId: string } };
  const subagentConversationId = body.subagent.conversationId;

  const installed = await reactors.inspectAll(session.id);
  assert.equal(installed.length, 1);
  const [reactor] = installed;
  assert.equal(reactor.spec.name, "supervise");
  assert.equal(reactor.participantId, orchestratorId);
  assert.equal(reactor.homeConversationId, homeConversationId);
  assert.deepEqual(reactor.scope.memberships, [
    { conversationId: subagentConversationId, participantId: orchestratorId },
  ]);
});

test("the supervisor fires when its sub-agent thread carries a cause", async () => {
  const { store, reactors, post } = await serve();
  const session = await store.createSession({ name: "S" });
  await post("/spawn", { sessionId: session.id, name: "worker" });
  const [reactor] = await reactors.inspectAll(session.id);

  // A folded state that has not yet seen a cause does not fire.
  assert.equal(reactor.ready, false);

  await reactors.observe(session.id, "conv-worker", {
    conversationId: "conv-worker",
    seq: 1,
    authorId: "system",
    sourceKind: "system",
    mentions: [],
    endsRun: false,
    cause: {
      kind: "budget-exhausted",
      budget: "wave-depth",
      limit: 24,
      participantId: "worker",
      conversationId: "conv-worker",
      waveDepth: 24,
    },
  });

  const [observed] = await reactors.inspectAll(session.id);
  assert.equal(observed.ready, true);
});

test("killing a sub-agent removes its supervise reactor", async () => {
  const { store, reactors, killed, post } = await serve();
  const session = await store.createSession({ name: "S" });
  const res = await post("/spawn", { sessionId: session.id, name: "worker" });
  const body = (await res.json()) as { subagent: { id: string } };

  assert.equal((await reactors.inspectAll(session.id)).length, 1);

  const kill = await post("/kill", {
    sessionId: session.id,
    agentId: body.subagent.id,
  });
  assert.equal(kill.status, 200);
  assert.deepEqual(killed, [body.subagent.id]);
  assert.equal((await reactors.inspectAll(session.id)).length, 0);
});

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
  const port = serveList(store, live);

  const res = await fetch(
    `http://127.0.0.1:${port}/internal/agents/list?sessionId=${session.id}`,
    { headers: { authorization: `Bearer ${TOKEN}` } },
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

/** A resolver whose one live token belongs to `worker` in `sessionId`. */
function workerResolver(sessionId: string): AgentCallerResolver {
  return {
    resolveAgentToken: (token) =>
      token === "worker-token" ? { sessionId, agentId: "worker" } : undefined,
  };
}

test("an agent token must match the session a request names", async () => {
  const store = new InMemorySessionStore(new InMemoryParticipantStore());
  const session = await store.createSession({ name: "S" });
  const { killed, post } = await serve(workerResolver(session.id));

  const other = await post(
    "/kill",
    { sessionId: "another-session", agentId: "worker" },
    "worker-token",
  );
  assert.equal(other.status, 403);
  assert.deepEqual(
    ((await other.json()) as { code: string }).code,
    "agent_mismatch",
  );
  assert.deepEqual(killed, []);

  const own = await post(
    "/kill",
    { sessionId: session.id, agentId: "worker" },
    "worker-token",
  );
  assert.equal(own.status, 200);
  assert.deepEqual(killed, ["worker"]);
});

test("a report must come from the sub-agent it is attributed to", async () => {
  const store = new InMemorySessionStore(new InMemoryParticipantStore());
  const session = await store.createSession({ name: "S" });
  const { post } = await serve(workerResolver(session.id));

  const forged = await post(
    "/report",
    { sessionId: session.id, agentId: "other-worker", text: "done" },
    "worker-token",
  );
  assert.equal(forged.status, 403);

  const absent = await post("/report", {
    sessionId: session.id,
    agentId: "other-worker",
    text: "done",
  });
  assert.notEqual(absent.status, 403, "no token keeps the old behaviour");

  const unknown = await post(
    "/report",
    { sessionId: session.id, agentId: "other-worker", text: "done" },
    "stale-token",
  );
  assert.notEqual(
    unknown.status,
    403,
    "an unknown token keeps the old behaviour",
  );
});

test("a spawned sub-agent inherits the orchestrator's whole identity set", async () => {
  const { store, seeded, post } = await serve(undefined, ["alice@x", "bob@x"]);
  const session = await store.createSession({ name: "S" });

  const res = await post("/spawn", { sessionId: session.id, name: "worker" });
  assert.equal(res.status, 200);
  assert.deepEqual(seeded, [
    { agentId: "worker", participants: ["alice@x", "bob@x"] },
  ]);
});
