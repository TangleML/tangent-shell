import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ChatAnswer,
  ChatAuthor,
  QuestionItem,
} from "@tangent/shared/contracts.ts";
import { pendingQuestions } from "@tangent/shared/questions.ts";
import type { Server } from "socket.io";

import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import type { DeliveryRequest } from "../connectors/types.ts";
import { InMemoryMembershipStore } from "../store/inMemoryMembershipStore.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import { ConversationRouter } from "./conversationRouter.ts";
import { MembershipRegistry } from "./membershipRegistry.ts";
import {
  parseAnswer,
  type QuestionClock,
  QuestionRegistry,
} from "./questions.ts";

const HUMAN: ChatAuthor = { id: "ada@example.com", kind: "human", name: "Ada" };
const DAY_MS = 24 * 60 * 60 * 1000;

const SCOPE: QuestionItem = {
  id: "scope",
  header: "Scope",
  question: "Which datasets should I include?",
  options: [
    { label: "Last 30 days (Recommended)" },
    { label: "All time", description: "Slower" },
  ],
};

const OUTPUTS: QuestionItem = {
  id: "outputs",
  header: "Outputs",
  question: "What should the report contain?",
  options: [{ label: "Chart" }, { label: "Table" }, { label: "Summary" }],
  multiSelect: true,
};

const NOTES: QuestionItem = {
  id: "notes",
  header: "Notes",
  question: "Anything else?",
  options: [],
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

/** A router and registry over in-memory stores, with Prime in the session.
 * `delivered` is who the fan-out woke. */
async function makeHarness(sessions = new InMemorySessionStore()) {
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
  const io = {
    to: () => ({ emit: () => {} }),
  } as unknown as Server;
  const delivered: DeliveryRequest[] = [];
  const router = new ConversationRouter(io, sessions, memberships);
  router.useConnectors({
    resolve: () => ({
      deliver: (request: DeliveryRequest) => {
        delivered.push(request);
        return { delivered: true };
      },
    }),
  } as unknown as ConnectorRegistry);
  const { clock, advance } = manualClock();
  const questions = new QuestionRegistry(sessions, undefined, clock);
  router.useQuestions(questions);
  const changes: string[] = [];
  questions.useOnChange((sessionId) => changes.push(sessionId));
  return { sessions, router, questions, advance, changes, delivered };
}

type Harness = Awaited<ReturnType<typeof makeHarness>>;

async function ask(h: Harness, items = [SCOPE], key?: string) {
  const outcome = await h.questions.ask({
    sessionId: "s1",
    questions: items,
    idempotencyKey: key,
  });
  assert.ok(outcome.ok, outcome.ok ? "" : outcome.error);
  return outcome;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function transcript(h: Harness) {
  await settle();
  return h.sessions.getMessages("s1");
}

/** Claims and posts an answer the way the socket handler does. */
async function answerWith(h: Harness, questionId: string, answer: ChatAnswer) {
  const check = await h.questions.claimAnswer("s1", questionId, answer);
  assert.ok(check.ok, check.ok ? "" : check.error);
  await h.router.post({
    sessionId: "s1",
    conversationId: check.pending.conversationId,
    author: HUMAN,
    content: check.content,
    inReplyTo: questionId,
    answer,
  });
  return check;
}

test("asking posts a question in Prime's thread and reports awaiting input", async () => {
  const h = await makeHarness();
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
  assert.deepEqual(h.delivered, [], "asking wakes no one");
});

test("an answer closes the question and wakes Prime with what was picked", async () => {
  const h = await makeHarness();
  const { question } = await ask(h, [SCOPE, OUTPUTS, NOTES]);

  const check = await answerWith(h, question.id, {
    answers: [
      { id: "scope", selected: ["All time"] },
      { id: "outputs", selected: ["Chart", "Table"], other: "and a CSV" },
      { id: "notes", selected: [], other: "Skip weekends" },
    ],
  });

  assert.match(check.content, /Scope .*: All time/);
  assert.match(check.content, /Outputs .*: Chart, Table, "and a CSV"/);
  assert.match(check.content, /Notes .*: "Skip weekends"/);
  assert.equal(h.questions.awaiting("s1"), undefined);
  assert.deepEqual(h.questions.awaitingSessions(), []);
  const messages = await transcript(h);
  assert.equal(messages.filter((m) => m.questionClosed).length, 0);
  assert.equal(h.delivered.length, 1);
  assert.equal(h.delivered[0].participantId, "prime");
});

test("answers that don't fit the question are refused", async () => {
  const h = await makeHarness();
  const { question } = await ask(h, [SCOPE, NOTES]);
  const refused = async (answer: ChatAnswer) => {
    const check = await h.questions.claimAnswer("s1", question.id, answer);
    assert.equal(check.ok, false);
  };

  await refused({ answers: [{ id: "scope", selected: ["Next year"] }] });
  await refused({
    answers: [
      { id: "scope", selected: ["All time", "Last 30 days (Recommended)"] },
    ],
  });
  await refused({ answers: [{ id: "notes", selected: [] }] });
  await refused({ answers: [{ id: "other", selected: [], other: "x" }] });
  await refused({
    answers: [
      { id: "scope", selected: ["All time"] },
      { id: "scope", selected: ["All time"] },
    ],
  });
  await refused({ answers: [] });

  await h.questions.cancel("s1", question.id);
  await refused({ answers: [{ id: "scope", selected: ["All time"] }] });
});

test("a claimed question refuses a second answer until the claim is released", async () => {
  const h = await makeHarness();
  const { question } = await ask(h);
  const answer = { answers: [{ id: "scope", selected: ["All time"] }] };

  const [first, second] = await Promise.all([
    h.questions.claimAnswer("s1", question.id, answer),
    h.questions.claimAnswer("s1", question.id, answer),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);

  h.questions.releaseAnswer("s1", question.id);
  const retry = await h.questions.claimAnswer("s1", question.id, answer);
  assert.equal(retry.ok, true);
});

test("a person's plain reply leaves the question open and reminds Prime of it", async () => {
  const h = await makeHarness();
  const { question } = await ask(h, [SCOPE, NOTES]);
  const [asked] = await transcript(h);

  await h.router.post({
    sessionId: "s1",
    conversationId: asked.conversationId,
    author: HUMAN,
    content: "All time, please.",
  });

  assert.equal(h.questions.awaiting("s1")?.count, 1);
  assert.equal((await transcript(h)).filter((m) => m.questionClosed).length, 0);
  assert.equal(h.delivered.length, 1);
  assert.match(h.delivered[0].text, /^All time, please\./);
  assert.match(
    h.delivered[0].text,
    new RegExp(
      `Still waiting on your question: ${question.id} \\(Scope, Notes\\)`,
    ),
  );
  assert.match(h.delivered[0].text, /cancel_question/);
});

test("a message in another thread carries no reminder", async () => {
  const h = await makeHarness();
  await ask(h);

  await h.router.post({
    sessionId: "s1",
    conversationId: "another-thread",
    author: HUMAN,
    content: "Unrelated note.",
  });

  assert.ok(h.delivered.every((d) => !/Still waiting/.test(d.text)));
});

test("an expired question closes with a notice that wakes Prime", async () => {
  const h = await makeHarness();
  const woken: string[] = [];
  h.questions.useWaker(async (sessionId) => {
    woken.push(sessionId);
    return true;
  });
  const { question } = await ask(h);

  h.advance(DAY_MS + 1);
  const notice = (await transcript(h)).find((m) => m.questionClosed);
  assert.deepEqual(notice?.questionClosed, { reason: "expired" });
  assert.equal(notice?.inReplyTo, question.id);
  assert.deepEqual(notice?.mentions, ["prime"]);
  assert.deepEqual(woken, ["s1"]);
  assert.deepEqual(
    h.delivered.map((d) => d.participantId),
    ["prime"],
  );
  assert.equal(h.questions.awaiting("s1"), undefined);
});

test("an expired question still closes when waking Prime fails", async () => {
  const h = await makeHarness();
  h.questions.useWaker(async () => {
    throw new Error("spawn failed");
  });
  await ask(h);

  h.advance(DAY_MS + 1);
  const notice = (await transcript(h)).find((m) => m.questionClosed);
  assert.deepEqual(notice?.questionClosed, { reason: "expired" });
  assert.deepEqual(notice?.mentions, []);
  assert.equal(h.questions.awaiting("s1"), undefined);
});

test("an ask racing a read of the same fold keeps its question tracked", async () => {
  const h = await makeHarness();
  h.questions.useWaker(async () => true);

  const [, asked] = await Promise.all([
    h.questions.listPending("s1"),
    h.questions.ask({ sessionId: "s1", questions: [SCOPE] }),
  ]);

  assert.ok(asked.ok);
  assert.equal(h.questions.awaiting("s1")?.count, 1);
  h.advance(DAY_MS + 1);
  const notice = (await transcript(h)).find((m) => m.questionClosed);
  assert.deepEqual(notice?.questionClosed, { reason: "expired" });
});

test("a question's own expiry is honoured, and tells Prime it may go ahead", async () => {
  const h = await makeHarness();
  const outcome = await h.questions.ask({
    sessionId: "s1",
    questions: [SCOPE],
    expiresInSeconds: 300,
  });
  assert.ok(outcome.ok);

  h.advance(299_000);
  assert.equal(h.questions.awaiting("s1")?.count, 1);
  h.advance(2_000);
  const notice = (await transcript(h)).find((m) => m.questionClosed);
  assert.deepEqual(notice?.questionClosed, { reason: "expired" });
  assert.match(notice?.content ?? "", /option you marked \(Recommended\)/);
});

test("an expired question with no recommendation tells Prime to decide without it", async () => {
  const h = await makeHarness();
  await ask(h, [NOTES]);

  h.advance(DAY_MS + 1);
  const notice = (await transcript(h)).find((m) => m.questionClosed);
  assert.match(notice?.content ?? "", /Decide without the answer/);
});

test("expiry timers are re-armed from the transcript after a restart", async () => {
  const first = await makeHarness();
  await ask(first);
  await settle();

  const restarted = await makeHarness(first.sessions);
  await restarted.questions.listPending("s1");
  restarted.advance(DAY_MS + 1);
  const notice = (await transcript(restarted)).find((m) => m.questionClosed);
  assert.deepEqual(notice?.questionClosed, { reason: "expired" });
});

test("Prime can't cancel a question a person is answering right now", async () => {
  const h = await makeHarness();
  const { question } = await ask(h);
  const claim = await h.questions.claimAnswer("s1", question.id, {
    answers: [{ id: "scope", selected: ["All time"] }],
  });
  assert.ok(claim.ok);

  assert.equal(await h.questions.cancel("s1", question.id), "answering");
  h.questions.releaseAnswer("s1", question.id);
  assert.equal(await h.questions.cancel("s1", question.id), "cancelled");
});

test("a session folded only when a reply arrives still reminds Prime", async () => {
  const first = await makeHarness();
  const { question } = await ask(first);
  const [asked] = await transcript(first);

  const restarted = await makeHarness(first.sessions);
  await restarted.router.post({
    sessionId: "s1",
    conversationId: asked.conversationId,
    author: HUMAN,
    content: "Still thinking about it.",
  });

  assert.match(restarted.delivered[0]?.text ?? "", new RegExp(question.id));
  assert.equal(restarted.questions.awaiting("s1")?.count, 1);
});

test("a retry key whose question was closed asks a new question", async () => {
  const h = await makeHarness();
  const first = await ask(h, [SCOPE], "pick-scope");
  await h.questions.cancel("s1", first.question.id);

  const again = await ask(h, [SCOPE], "pick-scope");
  assert.equal(again.reused, false);
  assert.notEqual(again.question.id, first.question.id);
});

test("an expired question in a session that mustn't be woken closes quietly", async () => {
  const h = await makeHarness();
  h.questions.useWaker(async () => false);
  await ask(h);

  h.advance(DAY_MS + 1);
  const notice = (await transcript(h)).find((m) => m.questionClosed);
  assert.deepEqual(notice?.mentions, []);
  assert.deepEqual(h.delivered, []);
});

test("Prime cancelling a question closes it with its reason, waking no one", async () => {
  const h = await makeHarness();
  const { question } = await ask(h);

  assert.equal(
    await h.questions.cancel("s1", question.id, "Answered in chat: all time"),
    "cancelled",
  );
  assert.equal(await h.questions.cancel("s1", question.id), "closed");
  const notice = (await transcript(h)).find((m) => m.questionClosed);
  assert.deepEqual(notice?.questionClosed, {
    reason: "cancelled",
    note: "Answered in chat: all time",
  });
  assert.match(notice?.content ?? "", /cancelled by Prime: Answered in chat/);
  assert.equal(h.questions.awaiting("s1"), undefined);
  assert.deepEqual(h.delivered, []);
});

test("pending questions are rebuilt from the transcript, and a retry key reuses one", async () => {
  const first = await makeHarness();
  const { question } = await ask(first, [SCOPE], "pick-scope");
  await settle();

  const restarted = await makeHarness(first.sessions);
  const pending = await restarted.questions.listPending("s1");
  assert.deepEqual(
    pending.map((entry) => entry.question.id),
    [question.id],
  );
  assert.equal(restarted.questions.awaiting("s1")?.count, 1);

  const retried = await ask(restarted, [SCOPE], "pick-scope");
  assert.equal(retried.reused, true);
  assert.equal(retried.question.id, question.id);
});

test("an answer observed while the transcript is being read still closes its question", async () => {
  const first = await makeHarness();
  const { question } = await ask(first);
  const [asked] = await transcript(first);

  const restarted = await makeHarness(first.sessions);
  const folding = restarted.questions.listPending("s1");
  restarted.questions.observe({
    ...asked,
    id: "late-answer",
    seq: asked.seq + 1,
    author: HUMAN,
    source: { kind: "human" },
    question: undefined,
    correlationId: undefined,
    inReplyTo: question.id,
    answer: { answers: [{ id: "scope", selected: ["All time"] }] },
  });

  assert.deepEqual(await folding, []);
});

test("malformed question sets and a fifth pending question are refused", async () => {
  const h = await makeHarness();
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
  const duplicateIds = await h.questions.ask({
    sessionId: "s1",
    questions: [SCOPE, SCOPE],
  });
  assert.equal(duplicateIds.ok, false);

  for (let i = 0; i < 4; i += 1) await ask(h);
  const fifth = await h.questions.ask({ sessionId: "s1", questions: [SCOPE] });
  assert.equal(fifth.ok, false);
});

test("parseAnswer keeps well-formed answers and rejects anything else", () => {
  assert.deepEqual(
    parseAnswer({
      answers: [{ id: "scope", selected: ["All time"], other: "  note  " }],
      extra: true,
    }),
    { answers: [{ id: "scope", selected: ["All time"], other: "note" }] },
  );
  assert.deepEqual(parseAnswer({ answers: [{ id: "notes", other: "x" }] }), {
    answers: [{ id: "notes", selected: [], other: "x" }],
  });
  for (const raw of [
    undefined,
    "All time",
    { answers: [null] },
    { answers: [{ id: "scope", selected: "All time" }] },
    { answers: [{ id: "scope", selected: [], other: 5 }] },
    { answers: [{ id: 1, selected: [] }] },
  ]) {
    assert.equal(parseAnswer(raw), undefined, JSON.stringify(raw));
  }
});

test("the shared fold agrees with the server over a transcript", async () => {
  const h = await makeHarness();
  const first = await ask(h);
  const second = await ask(h);
  await h.questions.cancel("s1", first.question.id);

  const messages = await transcript(h);
  assert.deepEqual(
    pendingQuestions(messages).map((entry) => entry.question.id),
    [second.question.id],
  );
  assert.deepEqual(
    pendingQuestions(messages, Date.parse("2030-01-01T00:00:00Z")),
    [],
  );
});
