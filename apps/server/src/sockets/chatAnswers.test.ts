import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type ChatAnswerAck,
  type ChatMessagePayload,
  humanAuthor,
  type Session,
} from "@tangent/shared/contracts.ts";
import type { Server, Socket } from "socket.io";

import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import { ConversationRouter } from "../conversation/conversationRouter.ts";
import { MembershipRegistry } from "../conversation/membershipRegistry.ts";
import { QuestionRegistry } from "../conversation/questions.ts";
import { InMemoryMembershipStore } from "../store/inMemoryMembershipStore.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import { type ChatHandlerDeps, handleChatMessage } from "./chat.ts";

const AUTHOR = humanAuthor({
  email: "ada@example.com",
  first_name: "Ada",
  last_name: "Lovelace",
});

const SESSION: Session = {
  id: "s1",
  name: "Session",
  rootPath: "/tmp/s1",
  status: "created",
  archived: false,
  accessPolicy: "open",
  tags: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** The chat handler over a real router and question registry, with a socket
 * that records `error` events. */
async function makeHarness() {
  const sessions = new InMemorySessionStore();
  await sessions.recordAgent("s1", {
    id: "prime",
    role: "prime",
    name: "Prime",
  });
  const memberships = new MembershipRegistry(
    sessions,
    new InMemoryMembershipStore(),
    () => true,
  );
  const io = { to: () => ({ emit: () => {} }) } as unknown as Server;
  const conversations = new ConversationRouter(io, sessions, memberships);
  conversations.useConnectors({
    resolve: () => ({ deliver: () => ({ delivered: true }) }),
  } as unknown as ConnectorRegistry);
  const questions = new QuestionRegistry(sessions);
  conversations.useQuestions(questions);

  const deps = {
    store: withSession(sessions),
    conversations,
    questions,
    pi: { hasAgent: () => true },
  } as unknown as ChatHandlerDeps;

  const errors: unknown[] = [];
  const socket = {
    emit: (event: string, payload: unknown) => {
      if (event === "error") errors.push(payload);
    },
  } as unknown as Socket;

  const questionId = await askScope(questions);

  const send = async (payload: Partial<ChatMessagePayload>, withAck = true) => {
    const acks: ChatAnswerAck[] = [];
    await handleChatMessage(
      socket,
      deps,
      AUTHOR,
      { sessionId: "s1", content: "", ...payload } as ChatMessagePayload,
      withAck ? (ack) => acks.push(ack) : undefined,
    );
    return acks;
  };
  const answers = async () =>
    (await sessions.getMessages("s1")).filter((m) => m.answer);

  return { questionId, send, answers, errors };
}

/** The store, answering `getSession` for the one test session. */
function withSession(sessions: InMemorySessionStore): InMemorySessionStore {
  return new Proxy(sessions, {
    get: (target, key) =>
      key === "getSession"
        ? async (id: string) => (id === "s1" ? SESSION : undefined)
        : Reflect.get(target, key, target),
  });
}

async function askScope(questions: QuestionRegistry): Promise<string> {
  const asked = await questions.ask({
    sessionId: "s1",
    questions: [
      {
        id: "scope",
        header: "Scope",
        question: "Which datasets?",
        options: [{ label: "Last 30 days" }, { label: "All time" }],
      },
    ],
  });
  assert.ok(asked.ok);
  return asked.question.id;
}

test("a valid answer is posted with the server's text and acknowledged", async () => {
  const h = await makeHarness();

  const acks = await h.send({
    inReplyTo: h.questionId,
    answer: { answers: [{ id: "scope", selected: ["All time"] }] },
  });

  assert.deepEqual(acks, [{ ok: true }]);
  const [posted] = await h.answers();
  assert.equal(posted.inReplyTo, h.questionId);
  assert.equal(posted.author.id, AUTHOR.id);
  assert.match(posted.content, /Scope \(Which datasets\?\): All time/);
});

test("malformed answers are refused through the ack, without posting or throwing", async () => {
  const h = await makeHarness();
  const malformed: unknown[] = [
    "All time",
    { answers: [null] },
    { answers: [{ id: "scope", selected: "All time", other: "x" }] },
    { answers: [{ id: "scope", selected: [], other: 5 }] },
    { answers: [{ id: "scope", selected: ["Next year"] }] },
  ];

  for (const answer of malformed) {
    const acks = await h.send({
      inReplyTo: h.questionId,
      answer: answer as ChatMessagePayload["answer"],
    });
    assert.equal(acks.length, 1, JSON.stringify(answer));
    assert.equal(acks[0].ok, false);
    assert.ok(acks[0].error);
  }
  assert.deepEqual(await h.answers(), []);
});

test("an answer to a closed question is refused, as an error event without an ack", async () => {
  const h = await makeHarness();
  const answer = { answers: [{ id: "scope", selected: ["All time"] }] };

  await h.send({ inReplyTo: h.questionId, answer });
  const acks = await h.send({ inReplyTo: h.questionId, answer }, false);

  assert.deepEqual(acks, []);
  assert.equal(h.errors.length, 1);
  assert.equal((await h.answers()).length, 1);
});
