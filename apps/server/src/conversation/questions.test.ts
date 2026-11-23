import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type ChatAuthor,
  type ChatMessage,
  type QuestionItem,
} from "@tangent/shared/contracts.ts";
import { pendingQuestions } from "@tangent/shared/questions.ts";
import type { Server } from "socket.io";

import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import { InMemoryMembershipStore } from "../store/inMemoryMembershipStore.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import { ConversationRouter } from "./conversationRouter.ts";
import { MembershipRegistry } from "./membershipRegistry.ts";
import { type QuestionClock, QuestionRegistry } from "./questions.ts";

const HUMAN: ChatAuthor = { id: "ada@example.com", kind: "human", name: "Ada" };

const SCOPE: QuestionItem = {
  id: "scope",
  header: "Scope",
  question: "Which datasets should I include?",
  options: [
    { label: "Last 30 days (Recommended)" },
    { label: "All time", description: "Slower" },
  ],
};

/** A clock whose scheduled callbacks run only when the test advances it. */
function manualClock() {
  let now = Date.parse("2026-01-01T00:00:00Z");
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const clock: QuestionClock = {
    now: () => now,
    schedule: (at, fn) => {
      const timer = { at, fn, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const timer of timers) {
      if (timer.live && timer.at <= now) {
        timer.live = false;
        timer.fn();
      }
    }
  };
  return { clock, advance };
}

function makeHarness(sessions = new InMemorySessionStore()) {
  const memberships = new MembershipRegistry(
    sessions,
    new InMemoryMembershipStore(),
    () => true,
  );
  const io = {
    to: () => ({ emit: () => {} }),
  } as unknown as Server;
  const router = new ConversationRouter(io, sessions, memberships);
  router.useConnectors({
    resolve: () => ({ deliver: () => ({ delivered: true }) }),
  } as unknown as ConnectorRegistry);
  const { clock, advance } = manualClock();
  const questions = new QuestionRegistry(sessions, undefined, clock);
  router.useQuestions(questions);
  const changes: string[] = [];
  questions.useOnChange((sessionId) => changes.push(sessionId));
  return { sessions, router, questions, advance, changes };
}

async function ask(h: ReturnType<typeof makeHarness>, key?: string) {
  const outcome = await h.questions.ask({
    sessionId: "s1",
    questions: [SCOPE],
    idempotencyKey: key,
  });
  assert.ok(outcome.ok);
  return outcome;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function transcript(h: ReturnType<typeof makeHarness>) {
  await settle();
  return h.sessions.getMessages("s1");
}

test("asking posts a question message with a Markdown fallback and reports awaiting input", async () => {
  const h = makeHarness();
  const { question, messageId } = await ask(h);

  const [message] = await transcript(h);
  assert.equal(message.id, messageId);
  assert.equal(message.author.id, "prime");
  assert.equal(message.correlationId, question.id);
  assert.deepEqual(message.question?.questions[0].options[0], {
    label: "Last 30 days (Recommended)",
  });
  assert.match(message.content, /Which datasets should I include\?/);
  assert.equal(h.questions.awaiting("s1")?.count, 1);
  assert.deepEqual(h.questions.awaitingSessions(), ["s1"]);
  assert.ok(h.changes.includes("s1"));
});

test("a valid answer closes the question and tells Prime what was picked", async () => {
  const h = makeHarness();
  const { question } = await ask(h);
  const answer = {
    answers: [{ id: "scope", selected: ["All time"], other: "skip test" }],
  };

  const check = await h.questions.checkAnswer("s1", question.id, answer);
  assert.ok(check.ok);
  assert.match(check.content, /Scope .*: All time, "skip test"/);

  await h.router.post({
    sessionId: "s1",
    conversationId: check.pending.conversationId,
    author: HUMAN,
    content: check.content,
    inReplyTo: question.id,
    answer,
  });

  assert.equal(h.questions.awaiting("s1"), undefined);
  const messages = await transcript(h);
  assert.equal(messages.length, 2);
  assert.equal(
    messages.some((message) => message.questionClosed),
    false,
  );
});

test("an answer naming an unknown option or a closed question is refused", async () => {
  const h = makeHarness();
  const { question } = await ask(h);

  const bad = await h.questions.checkAnswer("s1", question.id, {
    answers: [{ id: "scope", selected: ["Next year"] }],
  });
  assert.equal(bad.ok, false);

  const tooMany = await h.questions.checkAnswer("s1", question.id, {
    answers: [
      { id: "scope", selected: ["All time", "Last 30 days (Recommended)"] },
    ],
  });
  assert.equal(tooMany.ok, false);

  await h.questions.cancel("s1", question.id);
  const closed = await h.questions.checkAnswer("s1", question.id, {
    answers: [{ id: "scope", selected: ["All time"] }],
  });
  assert.equal(closed.ok, false);
});

test("a person's plain message supersedes pending questions with a notice", async () => {
  const h = makeHarness();
  const { question, messageId } = await ask(h);
  const [asked] = await transcript(h);

  await h.router.post({
    sessionId: "s1",
    conversationId: asked.conversationId,
    author: HUMAN,
    content: "Actually, let's do something else.",
  });

  assert.equal(h.questions.awaiting("s1"), undefined);
  const notice = (await transcript(h)).find(
    (message) => message.questionClosed,
  );
  assert.equal(notice?.inReplyTo, question.id);
  assert.deepEqual(notice?.questionClosed, { reason: "superseded" });
  assert.equal(notice?.author.id, "system");
  assert.notEqual(notice?.id, messageId);
});

test("an unanswered question expires into a notice", async () => {
  const h = makeHarness();
  const { question } = await ask(h);

  h.advance(24 * 60 * 60 * 1000 + 1);
  const notice = (await transcript(h)).find(
    (message) => message.questionClosed,
  );
  assert.deepEqual(notice?.questionClosed, { reason: "expired" });
  assert.equal(notice?.inReplyTo, question.id);
  assert.equal(h.questions.awaiting("s1"), undefined);
});

test("pending questions are rebuilt from the transcript, and a retry key reuses one", async () => {
  const first = makeHarness();
  const { question } = await ask(first, "pick-scope");
  await settle();

  const restarted = makeHarness(first.sessions);
  await restarted.questions.load("s1");
  assert.equal(restarted.questions.awaiting("s1")?.count, 1);

  const retried = await ask(restarted, "pick-scope");
  assert.equal(retried.reused, true);
  assert.equal(retried.question.id, question.id);
});

test("malformed question sets and a fifth pending question are refused", async () => {
  const h = makeHarness();
  const oneOption = await h.questions.ask({
    sessionId: "s1",
    questions: [{ ...SCOPE, options: [{ label: "Only" }] }],
  });
  assert.equal(oneOption.ok, false);
  const longHeader = await h.questions.ask({
    sessionId: "s1",
    questions: [{ ...SCOPE, header: "A very long header" }],
  });
  assert.equal(longHeader.ok, false);

  for (let i = 0; i < 4; i += 1) await ask(h);
  const fifth = await h.questions.ask({ sessionId: "s1", questions: [SCOPE] });
  assert.equal(fifth.ok, false);
});

test("the shared fold agrees with the server over a transcript", async () => {
  const h = makeHarness();
  const first = await ask(h);
  const second = await ask(h);
  await h.questions.cancel("s1", first.question.id);

  const messages: ChatMessage[] = await transcript(h);
  assert.deepEqual(
    pendingQuestions(messages).map((entry) => entry.question.id),
    [second.question.id],
  );
  assert.deepEqual(
    pendingQuestions(messages, Date.parse("2030-01-01T00:00:00Z")),
    [],
  );
});
