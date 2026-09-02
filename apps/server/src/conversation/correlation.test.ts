import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatAuthor, ChatMessage } from "@tangent/shared/contracts.ts";

import { RunRegistry } from "../runs/runRegistry.ts";
import { InMemoryRunStore } from "../store/inMemoryRunStore.ts";
import { type CorrelationClock, CorrelationEngine } from "./correlation.ts";

const ASKER: ChatAuthor = { id: "sub-1", kind: "agent", name: "Worker" };

/** A controllable clock: nothing fires until `advance` passes its instant. */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const scheduled = new Map<number, { at: number; fn: () => void }>();
  const clock: CorrelationClock = {
    now: () => now,
    schedule: (at, fn) => {
      const id = seq++;
      scheduled.set(id, { at, fn });
      return () => scheduled.delete(id);
    },
  };
  return {
    clock,
    advance(ms: number) {
      now += ms;
      const due = [...scheduled.entries()]
        .filter(([, s]) => s.at <= now)
        .sort((a, b) => a[1].at - b[1].at);
      for (const [id, s] of due) {
        scheduled.delete(id);
        s.fn();
      }
    },
  };
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    sessionId: "s1",
    conversationId: "sub-1",
    seq: 1,
    author: ASKER,
    mentions: [],
    source: { kind: "agent" },
    content: "hi",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function engineWith(clock: CorrelationClock) {
  const runs = new RunRegistry(new InMemoryRunStore());
  const correlations = new CorrelationEngine(runs, clock);
  return { runs, correlations };
}

test("any participant can ask any other — the ask is on the envelope", () => {
  const { clock } = fakeClock();
  const { correlations } = engineWith(clock);

  correlations.openFromMessage(
    message({ correlationId: "c1", mentions: ["prime"] }),
  );

  const [outstanding] = correlations.listForSession("s1");
  assert.equal(outstanding.id, "c1");
  assert.equal(outstanding.askedBy, "sub-1");
  assert.equal(outstanding.askedOf, "prime");
  assert.equal(outstanding.conversationId, "sub-1");
});

test("a reply naming a correlation resolves its waiters", async () => {
  const { clock } = fakeClock();
  const { correlations } = engineWith(clock);

  correlations.openFromMessage(message({ correlationId: "c1" }));
  const outcome = correlations.waitFor("c1");

  const answered = correlations.resolve(
    message({ id: "m2", content: "zone-42", inReplyTo: "c1" }),
  );
  assert.equal(answered, true);

  const result = await outcome;
  assert.equal(result.status, "answered");
  if (result.status === "answered") {
    assert.equal(result.message.content, "zone-42");
  }
  assert.deepEqual(correlations.listForSession("s1"), []);
});

test("opening the same correlation twice is idempotent", () => {
  const { clock } = fakeClock();
  const { correlations } = engineWith(clock);

  const first = correlations.openFromMessage(message({ correlationId: "c1" }));
  const second = correlations.openFromMessage(
    message({ id: "m2", correlationId: "c1" }),
  );

  assert.deepEqual(first, second);
  assert.equal(correlations.listForSession("s1").length, 1);
});

test("an unanswered correlation times out and surfaces a system notice", async () => {
  const { clock, advance } = fakeClock();
  const { correlations } = engineWith(clock);
  const notices: { conversationId: string; text: string }[] = [];
  correlations.useNotify((_sessionId, conversationId, text) =>
    notices.push({ conversationId, text }),
  );

  correlations.openFromMessage(
    message({ correlationId: "c1", mentions: ["prime"] }),
  );
  const outcome = correlations.waitFor("c1");

  advance(25_000);

  const result = await outcome;
  assert.equal(result.status, "timeout");
  assert.deepEqual(correlations.listForSession("s1"), []);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].conversationId, "sub-1");
});

test("listForSession shows who is blocked on whom", () => {
  const { clock } = fakeClock();
  const { correlations } = engineWith(clock);

  correlations.openFromMessage(
    message({ correlationId: "c1", mentions: ["prime"] }),
  );
  correlations.openFromMessage(
    message({
      id: "m2",
      conversationId: "sub-2",
      author: { id: "sub-2", kind: "agent", name: "Scout" },
      correlationId: "c2",
      mentions: ["sub-1"],
    }),
  );

  const outstanding = correlations.listForSession("s1");
  assert.equal(outstanding.length, 2);
  assert.deepEqual(outstanding.map((o) => [o.askedBy, o.askedOf]).sort(), [
    ["sub-1", "prime"],
    ["sub-2", "sub-1"],
  ]);
});

test("a correlation is keyed by its asker's open run and survives the run settling", () => {
  const { clock } = fakeClock();
  const { runs, correlations } = engineWith(clock);

  const run = runs.open({
    sessionId: "s1",
    participantId: "sub-1",
    ingress: "tool",
  });
  correlations.openFromMessage(message({ correlationId: "c1" }));

  assert.deepEqual(
    correlations.listForRun(run.id).map((o) => o.id),
    ["c1"],
  );

  runs.settle(run.id, "completed");

  assert.deepEqual(
    correlations.listForRun(run.id).map((o) => o.id),
    ["c1"],
    "settling the run does not drop the outstanding correlation",
  );
});

test("waitFor before open still settles by timeout if the correlation never opens", async () => {
  const { clock, advance } = fakeClock();
  const { correlations } = engineWith(clock);

  const outcome = correlations.waitFor("never-opened");
  advance(25_000);

  const result = await outcome;
  assert.equal(result.status, "timeout");
});

test("waitFor before open is answered once the correlation opens and resolves", async () => {
  const { clock } = fakeClock();
  const { correlations } = engineWith(clock);

  const outcome = correlations.waitFor("c1");
  correlations.openFromMessage(message({ correlationId: "c1" }));
  correlations.resolve(
    message({ id: "m2", content: "answer", inReplyTo: "c1" }),
  );

  const result = await outcome;
  assert.equal(result.status, "answered");
  if (result.status === "answered") {
    assert.equal(result.message.content, "answer");
  }
});
