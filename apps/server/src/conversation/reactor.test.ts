import assert from "node:assert/strict";
import { test } from "node:test";

import { InMemoryReactorStore } from "../store/inMemoryReactorStore.ts";
import type { MessageFacts } from "./reaction.ts";
import { type ReactorClock, reactorFor } from "./reactor.ts";
import { ReactorRegistry, type ReactorWake } from "./reactorRegistry.ts";

/** A completion by default (`endsRun`), so a test says only what it varies. */
function facts(overrides: Partial<MessageFacts> = {}): MessageFacts {
  return {
    conversationId: "B1",
    seq: 1,
    authorId: "w1",
    sourceKind: "agent",
    mentions: [],
    endsRun: true,
    ...overrides,
  };
}

/** A hand-cranked clock: nothing fires until a test advances time to it. */
function fakeClock() {
  let current = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const clock: ReactorClock = {
    now: () => current,
    schedule: (at, fn) => {
      const id = seq++;
      pending.set(id, { at, fn });
      return () => pending.delete(id);
    },
  };
  async function advance(to: number) {
    current = to;
    const due = [...pending]
      .filter(([, entry]) => entry.at <= current)
      .sort((a, b) => a[1].at - b[1].at);
    for (const [id, entry] of due) {
      pending.delete(id);
      entry.fn();
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { clock, advance };
}

const singleScope = {
  memberships: [{ conversationId: "A", participantId: "prime" }],
  homeConversationId: "A",
};

test("awaitAll is not ready until every named participant has finished", () => {
  const reactor = reactorFor({
    name: "awaitAll",
    participants: ["w1", "w2", "w3"],
  });
  let state = reactor.observe(
    reactor.initial,
    facts({ authorId: "w1" }),
    "prime",
  );
  state = reactor.observe(state, facts({ authorId: "w2" }), "prime");
  assert.equal(reactor.ready(state), false, "2 of 3 is not the whole set");
  assert.deepEqual(state, { kind: "await", seen: ["w1", "w2"] });

  state = reactor.observe(state, facts({ authorId: "w3" }), "prime");
  assert.equal(reactor.ready(state), true);
  assert.deepEqual(reactor.onWake(state), { kind: "await", seen: [] });
});

test("awaitAll readiness is insensitive to the order completions merge in", () => {
  const reactor = reactorFor({
    name: "awaitAll",
    participants: ["w1", "w2", "w3"],
  });
  const fold = (order: string[]) =>
    order.reduce(
      (state, id) => reactor.observe(state, facts({ authorId: id }), "prime"),
      reactor.initial,
    );
  assert.deepEqual(fold(["w3", "w1", "w2"]), fold(["w1", "w2", "w3"]));
  assert.equal(reactor.ready(fold(["w3", "w1", "w2"])), true);
});

test("a non-final message is not a completion, and leaves state untouched", () => {
  const reactor = reactorFor({ name: "awaitAll", participants: ["w1"] });
  const state = reactor.observe(
    reactor.initial,
    facts({ authorId: "w1", endsRun: false }),
    "prime",
  );
  assert.equal(
    state,
    reactor.initial,
    "same reference, so no redundant persist",
  );
  assert.equal(reactor.ready(state), false);
});

test("awaitAll can wait on run ids instead of participant ids", () => {
  const reactor = reactorFor({ name: "awaitAll", runs: ["r1", "r2"] });
  let state = reactor.observe(
    reactor.initial,
    facts({ authorId: "w1", runId: "r1" }),
    "prime",
  );
  assert.equal(reactor.ready(state), false);
  state = reactor.observe(
    state,
    facts({ authorId: "w2", runId: "r2" }),
    "prime",
  );
  assert.equal(reactor.ready(state), true);
});

test("awaitQuorum is ready at n distinct completions and not before", () => {
  const reactor = reactorFor({
    name: "awaitQuorum",
    n: 2,
    of: ["w1", "w2", "w3"],
  });
  let state = reactor.observe(
    reactor.initial,
    facts({ authorId: "w1" }),
    "prime",
  );
  state = reactor.observe(state, facts({ authorId: "w1" }), "prime");
  assert.equal(reactor.ready(state), false, "the same worker twice is one");
  state = reactor.observe(state, facts({ authorId: "w2" }), "prime");
  assert.equal(reactor.ready(state), true);
});

test("firstOf wakes on the first completion and clears on wake", () => {
  const reactor = reactorFor({ name: "firstOf", participants: ["w1", "w2"] });
  const state = reactor.observe(
    reactor.initial,
    facts({ authorId: "w2" }),
    "prime",
  );
  assert.equal(reactor.ready(state), true);
  assert.deepEqual(reactor.onWake(state), { kind: "first", fired: false });
});

test("awaitDeadline wakes once its instant passes, then clears", async () => {
  const fc = fakeClock();
  const registry = new ReactorRegistry(new InMemoryReactorStore(), fc.clock);
  const wakes: ReactorWake[] = [];
  registry.useDelivery(async (wake) => {
    wakes.push(wake);
    return true;
  });
  const record = await registry.install({
    sessionId: "s1",
    participantId: "prime",
    spec: { name: "awaitDeadline", at: new Date(5000).toISOString() },
    scope: singleScope,
  });

  await fc.advance(4000);
  assert.equal(wakes.length, 0, "before the instant, nothing fires");
  assert.equal((await registry.inspect(record.id))?.ready, false);

  await fc.advance(5000);
  assert.equal(
    wakes.length,
    1,
    "and it wakes exactly once when the instant passes",
  );
  assert.equal(wakes[0].ingress, "schedule", "a timer wake is not a reaction");
  assert.equal(wakes[0].conversationId, "A");
  assert.equal(
    (await registry.inspect(record.id))?.ready,
    false,
    "onWake cleared it",
  );
});

test("debounce restarts its window on each message and fires once when quiet", async () => {
  const fc = fakeClock();
  const registry = new ReactorRegistry(new InMemoryReactorStore(), fc.clock);
  const wakes: ReactorWake[] = [];
  registry.useDelivery(async (wake) => {
    wakes.push(wake);
    return true;
  });
  await registry.install({
    sessionId: "s1",
    participantId: "prime",
    spec: { name: "debounce", windowMs: 1000 },
    scope: singleScope,
  });

  await registry.observe("s1", "A", facts({ seq: 1, endsRun: false }));
  await fc.advance(500);
  assert.equal(wakes.length, 0, "still within the window");

  await registry.observe("s1", "A", facts({ seq: 2, endsRun: false }));
  await fc.advance(1000);
  assert.equal(wakes.length, 0, "the second message restarted the window");

  await fc.advance(1500);
  assert.equal(
    wakes.length,
    1,
    "and it settles once the window finally elapses",
  );
});

test("supervise readies on a message carrying a cause and clears on wake", () => {
  const reactor = reactorFor({ name: "supervise" });
  let state = reactor.observe(
    reactor.initial,
    facts({ endsRun: true }),
    "prime",
  );
  assert.equal(
    reactor.ready(state),
    false,
    "an ordinary completion carries no cause",
  );
  assert.equal(state, reactor.initial, "and leaves state untouched");

  state = reactor.observe(
    state,
    facts({
      authorId: "w3",
      cause: {
        kind: "connector-detached",
        participantId: "w3",
        conversationId: "B3",
        waveDepth: 0,
      },
    }),
    "prime",
  );
  assert.equal(reactor.ready(state), true);
  assert.deepEqual(state, { kind: "cause", fired: true });
  assert.deepEqual(reactor.onWake(state), { kind: "cause", fired: false });
});

test("supervise may span the many conversations it watches, and wakes on a cause in any", async () => {
  const registry = new ReactorRegistry(new InMemoryReactorStore());
  const wakes: ReactorWake[] = [];
  registry.useDelivery(async (wake) => {
    wakes.push(wake);
    return true;
  });
  await registry.install({
    sessionId: "s1",
    participantId: "prime",
    spec: { name: "supervise" },
    scope: {
      memberships: [
        { conversationId: "B1", participantId: "prime" },
        { conversationId: "B2", participantId: "prime" },
        { conversationId: "B3", participantId: "prime" },
      ],
      homeConversationId: "A",
    },
  });

  await registry.observe("s1", "B1", facts({ authorId: "w1", endsRun: true }));
  assert.equal(wakes.length, 0, "an ordinary completion is not a failure");

  await registry.observe(
    "s1",
    "B3",
    facts({
      authorId: "w3",
      cause: {
        kind: "connector-detached",
        participantId: "w3",
        conversationId: "B3",
        waveDepth: 0,
      },
    }),
  );
  assert.equal(wakes.length, 1, "a cause in any watched conversation wakes it");
  assert.equal(
    wakes[0].conversationId,
    "A",
    "the supervisor wakes in its home",
  );
  assert.match(wakes[0].text, /connector-detached/);
  assert.match(wakes[0].text, /B3/);
});

test("a reactor over an unreadable spec never readies", () => {
  // A misconfigured awaitAll (no targets) is rejected at install rather than
  // treated as vacuously ready — an empty set must not wake on the first message.
  const registry = new ReactorRegistry(new InMemoryReactorStore());
  return assert.rejects(
    registry.install({
      sessionId: "s1",
      participantId: "prime",
      spec: { name: "awaitAll", participants: [] },
      scope: singleScope,
    }),
    /at least one target/,
  );
});

test("installing a multi-conversation debounce is refused", () => {
  const registry = new ReactorRegistry(new InMemoryReactorStore());
  return assert.rejects(
    registry.install({
      sessionId: "s1",
      participantId: "prime",
      spec: { name: "debounce", windowMs: 1000 },
      scope: {
        memberships: [
          { conversationId: "B1", participantId: "prime" },
          { conversationId: "B2", participantId: "prime" },
        ],
        homeConversationId: "A",
      },
    }),
    /single-membership scope/,
  );
});

test("a scope must be held entirely by the installing participant", () => {
  const registry = new ReactorRegistry(new InMemoryReactorStore());
  return assert.rejects(
    registry.install({
      sessionId: "s1",
      participantId: "prime",
      spec: { name: "awaitAll", participants: ["w1"] },
      scope: {
        memberships: [{ conversationId: "B1", participantId: "someone-else" }],
        homeConversationId: "A",
      },
    }),
    /held by the installing participant/,
  );
});
