import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import {
  type ChatAuthor,
  type ChatMessagePayload,
  connectorFor,
  humanAuthor,
  type Session,
  SocketEvents,
  type UserIdentity,
} from "@tangent/shared/contracts.ts";
import type { Socket } from "socket.io";

import type { Membership } from "../store/membershipStore.ts";
import type { SessionAgent } from "../store/sessionStore.ts";
import {
  authorizedConversations,
  type ChatHandlerDeps,
  handleChatMessage,
  registerChatHandlers,
} from "./chat.ts";
import { PresenceTracker } from "./presenceTracker.ts";

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
  const ensureCalls: unknown[][] = [];
  const postCalls: { conversationId?: string }[] = [];

  const deps = {
    store: {
      getSession: async () => session(OWNER),
      getSessionEnv: async () => undefined,
      listAgents: async () => [primeAgent(primeHome)],
    },
    pi: {
      ensure: (...args: unknown[]) => {
        ensureCalls.push(args);
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
  assert.equal(ensureCalls[0]?.[5], primeHome);
  assert.equal(postCalls[0]?.conversationId, "sub-1");
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
      ensure: () => {},
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
