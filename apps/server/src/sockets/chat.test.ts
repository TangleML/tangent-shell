import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mock, test } from "node:test";

import {
  type ChatAuthor,
  type ChatMessagePayload,
  connectorFor,
  humanAuthor,
  type Session,
  SocketEvents,
  type SubagentDismissPayload,
  type SubagentInfo,
  type SubagentRosterPayload,
  type UserIdentity,
} from "@tangent/shared/contracts.ts";
import type { Server, Socket } from "socket.io";

import type { PrimeSpawnOptions } from "../pi/piAgentManager.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import type { Membership } from "../store/membershipStore.ts";
import type { SessionAgent } from "../store/sessionStore.ts";
import {
  authorizedConversations,
  type ChatHandlerDeps,
  handleChatMessage,
  registerChatHandlers,
} from "./chat.ts";
import { PresenceTracker } from "./presenceTracker.ts";
import { createSubagentDismissedEmitter } from "./sessionRoster.ts";

const OWNER: UserIdentity = {
  email: "owner@example.com",
  first_name: "Olive",
  last_name: "Owner",
};

function session(
  user?: UserIdentity,
  accessPolicy: Session["accessPolicy"] = "restricted",
): Session {
  return {
    id: "s1",
    name: "Session",
    rootPath: "/tmp/s1",
    status: "created",
    user,
    archived: false,
    accessPolicy,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function agent(id: string): SessionAgent {
  return {
    id,
    sessionId: "s1",
    role: id === "prime" ? "prime" : "subagent",
    name: id,
    capabilities: id === "prime" ? ["orchestrator"] : [],
    status: "active",
    connector: connectorFor("pi-stdio"),
    homeConversationId: id,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function membership(participantId: string, conversationId: string): Membership {
  return {
    sessionId: "s1",
    participantId,
    conversationId,
    reaction: "never",
    ingress: "reaction",
    admission: "queue",
    transcriptVisibility: "shared",
  };
}

const AGENTS = [agent("prime"), agent("sub-1"), agent("sub-2")];

test("the session owner is authorized for every Conversation", () => {
  const author = humanAuthor(OWNER);
  const authorized = authorizedConversations(
    author,
    session(OWNER),
    AGENTS,
    [],
  );
  assert.deepEqual([...authorized].sort(), ["prime", "sub-1", "sub-2"]);
});

test("with no resolved creator, any human is treated as the owner", () => {
  const author = humanAuthor({
    email: "someone@example.com",
    first_name: "Sam",
    last_name: "One",
  });
  const authorized = authorizedConversations(
    author,
    session(undefined),
    AGENTS,
    [],
  );
  assert.deepEqual([...authorized].sort(), ["prime", "sub-1", "sub-2"]);
});

test("an invited human sees only the Conversations it holds a Membership in", () => {
  const guest: ChatAuthor = humanAuthor({
    email: "guest@example.com",
    first_name: "Gwen",
    last_name: "Guest",
  });
  const authorized = authorizedConversations(guest, session(OWNER), AGENTS, [
    membership("guest@example.com", "sub-1"),
  ]);
  assert.deepEqual([...authorized], ["sub-1"]);
});

test("a Membership in an unknown Conversation is ignored", () => {
  const guest = humanAuthor({
    email: "guest@example.com",
    first_name: "Gwen",
    last_name: "Guest",
  });
  const authorized = authorizedConversations(guest, session(OWNER), AGENTS, [
    membership("guest@example.com", "gone"),
  ]);
  assert.equal(authorized.size, 0);
});

test("an open session authorizes any human for every Conversation", () => {
  const stranger = humanAuthor({
    email: "stranger@example.com",
    first_name: "Stan",
    last_name: "Stranger",
  });
  const authorized = authorizedConversations(
    stranger,
    session(OWNER, "open"),
    AGENTS,
    [],
  );
  assert.deepEqual([...authorized].sort(), ["prime", "sub-1", "sub-2"]);
});

function primeAgent(homeConversationId: string): SessionAgent {
  return {
    id: "prime",
    sessionId: "s1",
    role: "prime",
    name: "Prime",
    capabilities: ["orchestrator"],
    status: "active",
    connector: connectorFor("pi-stdio"),
    homeConversationId,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

test("a human message always ensures Prime, even when it targets a sub-agent thread", async () => {
  const primeHome = "conv-prime-home";
  const ensureCalls: PrimeSpawnOptions[] = [];
  const postCalls: { conversationId?: string }[] = [];

  const deps = {
    store: {
      getSession: async () => session(OWNER),
      getSessionEnv: async () => undefined,
      listAgents: async () => [primeAgent(primeHome)],
    },
    pi: {
      ensure: async (
        _id: string,
        _root: string,
        options: PrimeSpawnOptions,
      ) => {
        ensureCalls.push(options);
      },
    },
    connectors: { list: () => [] },
    participantService: { list: async () => [] },
    conversations: {
      post: async (input: { conversationId?: string }) => {
        postCalls.push(input);
        return { message: {}, woke: [], refused: [] };
      },
    },
  } as unknown as ChatHandlerDeps;

  const socket = { emit: () => {} } as unknown as Socket;
  const payload: ChatMessagePayload = {
    sessionId: "s1",
    content: "hello",
    conversationId: "sub-1",
  };

  await handleChatMessage(socket, deps, humanAuthor(OWNER), payload);

  assert.equal(ensureCalls.length, 1);
  assert.equal(ensureCalls[0]?.homeConversationId, primeHome);
  assert.equal(postCalls[0]?.conversationId, "sub-1");
});

test("a slash command's result is posted without spawning Prime", async () => {
  let ensured = 0;
  const posts: { command?: unknown; mentions?: unknown }[] = [];
  const deps = {
    store: {
      getSession: async () => session(OWNER),
      listAgents: async () => [primeAgent("prime")],
    },
    pi: {
      ensure: async () => {
        ensured += 1;
      },
    },
    conversations: {
      post: async (input: { command?: unknown }) => {
        posts.push(input);
        return { message: {}, woke: [], refused: [] };
      },
    },
  } as unknown as ChatHandlerDeps;
  const payload: ChatMessagePayload = {
    sessionId: "s1",
    content: "- Train",
    command: { name: " runs ", args: "  " },
  };

  await handleChatMessage(
    { emit: () => {} } as unknown as Socket,
    deps,
    humanAuthor(OWNER),
    payload,
  );

  assert.equal(ensured, 0);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0]?.command, { name: "runs" });
  assert.equal(posts[0]?.mentions, undefined);
});

test("closing the last browser socket detaches presence without cancelling the server agent", async () => {
  const io = new EventEmitter();
  const socket = Object.assign(new EventEmitter(), {
    handshake: { headers: {}, auth: {} },
    join: async () => {},
  });
  const presence: string[] = [];
  let cancellations = 0;
  const deps = {
    io,
    presence: new PresenceTracker(),
    store: {
      getSession: async () => session(),
      getSessionEnv: async () => undefined,
      listAgents: async () => [primeAgent("prime")],
      getMessages: async () => [],
      getArtifacts: async () => [],
    },
    pi: {
      ensure: async () => {},
      listActivities: () => [],
      getAgentSelection: () => undefined,
      abort: () => {
        cancellations += 1;
      },
    },
    connectors: {
      revive: () => {},
      list: () => [],
      cancelRun: () => {
        cancellations += 1;
      },
    },
    triggerEngine: { sync: () => {}, list: () => [] },
    participantService: {
      get: async () => ({ id: "human" }),
      membershipsOf: async () => [],
      setPresence: async (_sessionId: string, _id: string, state: string) => {
        presence.push(state);
      },
    },
  } as unknown as ChatHandlerDeps;
  registerChatHandlers(deps);
  io.emit("connection", socket);
  socket.emit(SocketEvents.ChatJoin, { sessionId: "s1" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(presence, ["connected"]);
  socket.emit("disconnect");
  assert.deepEqual(presence, ["connected", "detached"]);
  assert.equal(cancellations, 0);
});

/**
 * A joinable session over a real in-memory store, with the connectors' live
 * roster under the test's control. Sockets carry no identity, so each acts as
 * {@link DEFAULT_USER}.
 */
async function rosterHarness(target: Session = session(undefined, "open")) {
  const store = new InMemorySessionStore();
  mock.method(store, "getSession", async (id: string) =>
    id === target.id ? target : undefined,
  );
  await store.recordAgent(target.id, {
    id: "prime",
    role: "prime",
    name: "Prime",
  });
  const live: SubagentInfo[] = [];
  const broadcasts: { event: string; payload: unknown }[] = [];
  const io = Object.assign(new EventEmitter(), {
    to: () => ({
      emit: (event: string, payload: unknown) =>
        broadcasts.push({ event, payload }),
    }),
  });
  registerChatHandlers(rosterDeps(io, store, live));

  const connect = () => {
    const socket = Object.assign(new EventEmitter(), {
      handshake: { headers: {}, auth: {} },
      join: async () => {},
    });
    io.emit("connection", socket);
    return socket;
  };

  /** A fresh client's join, resolved with the sub-agent roster it is sent. */
  const join = async (): Promise<SubagentInfo[]> => {
    const socket = connect();
    const roster = new Promise<SubagentRosterPayload>((resolve) =>
      socket.once(SocketEvents.SubagentRoster, resolve),
    );
    socket.emit(SocketEvents.ChatJoin, { sessionId: target.id });
    return (await roster).subagents;
  };

  const dismiss = async (agentId: string): Promise<void> => {
    const payload: SubagentDismissPayload = { sessionId: target.id, agentId };
    connect().emit(SocketEvents.SubagentDismiss, payload);
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  return { store, live, broadcasts, join, dismiss, sessionId: target.id };
}

/** Just enough of the chat deps for a join and a dismiss to run. */
function rosterDeps(
  io: EventEmitter,
  store: InMemorySessionStore,
  live: SubagentInfo[],
): ChatHandlerDeps {
  return {
    io,
    store,
    emitSubagentDismissed: createSubagentDismissedEmitter(
      io as unknown as Server,
    ),
    presence: new PresenceTracker(),
    pi: {
      ensure: () => {},
      listActivities: () => [],
      getAgentSelection: () => undefined,
    },
    connectors: { revive: () => {}, list: () => live },
    triggerEngine: { sync: () => {}, list: () => [] },
    participantService: {
      get: async () => undefined,
      membershipsOf: async () => [],
    },
  } as unknown as ChatHandlerDeps;
}

/** Records sub-agent `id` in the harness store with the given status. */
async function recordSubagent(
  store: InMemorySessionStore,
  sessionId: string,
  id: string,
  status: SubagentInfo["status"],
): Promise<SessionAgent> {
  return store.recordAgent(sessionId, {
    id,
    role: "subagent",
    name: `Worker ${id}`,
    status,
    model: "anthropic/claude-test",
  });
}

/** The live roster entry a connector holds for a recorded sub-agent. */
function liveInfo(
  agent: SessionAgent,
  status: SubagentInfo["status"],
): SubagentInfo {
  return {
    id: agent.id,
    conversationId: agent.homeConversationId,
    name: agent.name,
    status,
    connector: connectorFor("pi-stdio"),
    createdAt: agent.createdAt,
  };
}

test("a finished sub-agent stays in the join roster after its connector drops it", async () => {
  const { store, live, join, sessionId } = await rosterHarness();
  const worker = await recordSubagent(store, sessionId, "sub-1", "active");
  live.push(liveInfo(worker, "active"));
  assert.deepEqual(
    (await join()).map((s) => [s.id, s.status]),
    [["sub-1", "active"]],
  );

  await store.setAgentStatus(sessionId, "sub-1", "completed");
  live.length = 0;

  const [entry, ...rest] = await join();
  assert.deepEqual(rest, []);
  assert.equal(entry?.id, "sub-1");
  assert.equal(entry?.status, "completed");
  assert.equal(entry?.name, "Worker sub-1");
  assert.equal(entry?.conversationId, worker.homeConversationId);
  assert.equal(entry?.model, "anthropic/claude-test");
});

test("a sub-agent both live and persisted is listed once, as the live entry", async () => {
  const { store, live, join, sessionId } = await rosterHarness();
  const worker = await recordSubagent(store, sessionId, "sub-1", "completed");
  live.push(liveInfo(worker, "completed"));

  const roster = await join();
  assert.equal(roster.length, 1);
  assert.equal(roster[0], live[0]);
});

test("dismissing a finished sub-agent drops it from every later roster", async () => {
  const { store, broadcasts, join, dismiss, sessionId } = await rosterHarness();
  await recordSubagent(store, sessionId, "sub-1", "killed");
  assert.equal((await join()).length, 1);

  await dismiss("sub-1");

  assert.deepEqual(broadcasts, [
    {
      event: SocketEvents.SubagentDismissed,
      payload: { sessionId, agentId: "sub-1" },
    },
  ]);
  assert.deepEqual(await join(), []);
  const row = (await store.listAgents(sessionId)).find((a) => a.id === "sub-1");
  assert.ok(row?.dismissedAt, "the row is kept, stamped dismissed");
});

test("dismissing a sub-agent that is still running is rejected", async () => {
  const { store, live, broadcasts, join, dismiss, sessionId } =
    await rosterHarness();
  const worker = await recordSubagent(store, sessionId, "sub-1", "active");
  live.push(liveInfo(worker, "active"));

  await dismiss("sub-1");

  assert.deepEqual(broadcasts, []);
  const row = (await store.listAgents(sessionId)).find((a) => a.id === "sub-1");
  assert.equal(row?.dismissedAt, undefined);
  assert.deepEqual(
    (await join()).map((s) => s.id),
    ["sub-1"],
  );
});

test("a human without access to the sub-agent's thread cannot dismiss it", async () => {
  const { store, broadcasts, join, dismiss, sessionId } = await rosterHarness(
    session(OWNER),
  );
  await recordSubagent(store, sessionId, "sub-1", "completed");

  await dismiss("sub-1");

  assert.deepEqual(broadcasts, []);
  assert.deepEqual(
    (await join()).map((s) => s.id),
    ["sub-1"],
  );
});
