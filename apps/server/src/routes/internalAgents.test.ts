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
import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import type {
  ConversationRouter,
  CrossPostInput,
} from "../conversation/conversationRouter.ts";
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

/** A router that records each cross-Conversation post and wakes no one. */
function recordingRouter(posted: CrossPostInput[]): ConversationRouter {
  return {
    postToConversation: async (input: CrossPostInput) => {
      posted.push(input);
      return { woke: [], refused: [] };
    },
  } as unknown as ConversationRouter;
}

/** A run registry where only the `busy` participants have a Run open. */
function stubbedRuns(busy: string[]): RunRegistry {
  return {
    audienceFor: () => undefined,
    recordAudience: () => {},
    current: (_sessionId: string, participantId: string) =>
      busy.includes(participantId) ? { id: "run-1" } : undefined,
  } as unknown as RunRegistry;
}

/** A running internal-agents API over in-memory stores and stubbed connectors.
 * `busy` names the participants that have a Run open. */
async function serve(busy: string[] = []) {
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

  const posted: CrossPostInput[] = [];
  const conversations = recordingRouter(posted);
  const runs = stubbedRuns(busy);

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
    ),
  );

  const server = app.listen(0);
  cleanups.push(() => server.close());
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/internal/agents`;

  const post = (route: string, body: unknown) =>
    fetch(`${base}${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(body),
    });

  return { store, reactors, killed, posted, post };
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

test("a directive to a busy sub-agent steers its current run by default", async () => {
  const { store, posted, post } = await serve(["worker"]);
  const session = await store.createSession({ name: "S" });

  const res = await post("/message", {
    sessionId: session.id,
    agentId: "worker",
    text: "Stop retrying that query.",
  });

  assert.deepEqual(await res.json(), { ok: true, outcome: "steered" });
  assert.equal(posted.at(-1)?.delivery, "steer");
});

test("a follow-up directive to a busy sub-agent says it is queued", async () => {
  const { store, posted, post } = await serve(["worker"]);
  const session = await store.createSession({ name: "S" });

  const res = await post("/message", {
    sessionId: session.id,
    agentId: "worker",
    text: "When you're done, summarize.",
    delivery: "followUp",
  });

  assert.deepEqual(await res.json(), { ok: true, outcome: "queued" });
  assert.equal(posted.at(-1)?.delivery, "followUp");
});

test("a directive to an idle sub-agent starts a run", async () => {
  const { store, post } = await serve();
  const session = await store.createSession({ name: "S" });

  const res = await post("/message", {
    sessionId: session.id,
    agentId: "worker",
    text: "Begin.",
  });

  assert.deepEqual(await res.json(), { ok: true, outcome: "started" });
});
