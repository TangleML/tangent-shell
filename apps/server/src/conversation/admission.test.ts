import assert from "node:assert/strict";
import { test } from "node:test";

import type { AdmissionPolicy } from "@tangent/shared/contracts.ts";

import type { CancelResult, RunCancellation } from "../connectors/types.ts";
import { RunRegistry } from "../runs/runRegistry.ts";
import { InMemoryRunStore } from "../store/inMemoryRunStore.ts";
import { AdmissionEngine, type CancelRun } from "./admission.ts";

const SESSION = "s1";
const PARTICIPANT = "sub-1";
const CONVERSATION = "c1";

/** An engine over a real {@link RunRegistry}, with its release wired to settle
 * the way `index.ts` does, plus a recording of what actually got delivered. */
function makeEngine(cancel: CancelRun = () => ({ cancelled: false })) {
  const runs = new RunRegistry(new InMemoryRunStore());
  const engine = new AdmissionEngine(runs, cancel);
  runs.useOnSettled((run) => engine.release(run));
  const delivered: string[] = [];
  return { runs, engine, delivered };
}

/** Opens a Run so the participant reads as busy. */
function busy(runs: RunRegistry, participantId = PARTICIPANT): void {
  runs.open({ sessionId: SESSION, participantId, ingress: "reaction" });
}

/**
 * Admits one wake and, when the decision is `now`, performs the delivery the way
 * the fan-out engine would — so `delivered` records both immediate and released
 * wakes through the same recorder the engine holds for a deferred one.
 */
function admit(
  engine: AdmissionEngine,
  delivered: string[],
  policy: AdmissionPolicy,
  text: string,
  conversationId = CONVERSATION,
) {
  const decision = engine.admit({
    sessionId: SESSION,
    participantId: PARTICIPANT,
    conversationId,
    policy,
    waveDepth: 0,
    deliver: () => delivered.push(text),
  });
  if (decision.action === "now") delivered.push(text);
  return decision;
}

test("an idle participant takes any policy's wake immediately", () => {
  for (const policy of [
    "queue",
    "coalesce",
    "preempt",
    "reject",
  ] as AdmissionPolicy[]) {
    const { engine, delivered } = makeEngine();
    const decision = admit(engine, delivered, policy, "hi");
    assert.equal(decision.action, "now");
    assert.deepEqual(delivered, ["hi"]);
  }
});

test("queue delivers a mid-Run wake as today", () => {
  const { runs, engine, delivered } = makeEngine();
  busy(runs);

  const decision = admit(engine, delivered, "queue", "more");

  assert.equal(decision.action, "now");
  assert.deepEqual(delivered, ["more"]);
});

test("coalesce holds one latest wake and releases it when the Run settles", () => {
  const { runs, engine, delivered } = makeEngine();
  busy(runs);

  assert.equal(admit(engine, delivered, "coalesce", "first").action, "held");
  assert.equal(admit(engine, delivered, "coalesce", "second").action, "held");
  // A burst collapses to a single held wake, and nothing has been delivered yet.
  assert.equal(engine.depthFor(SESSION, PARTICIPANT), 1);
  assert.deepEqual(delivered, []);

  runs.settleOpenFor(SESSION, PARTICIPANT, "completed");

  assert.deepEqual(delivered, ["second"]);
  assert.equal(engine.depthFor(SESSION, PARTICIPANT), 0);
});

test("preempt whose cancel leaves the Run running holds until it settles", () => {
  // Pi's shape: abort only signals the process; the Run settles later on its own
  // stream end. `cancel` reports success but does not settle here.
  const { runs, engine, delivered } = makeEngine(() => ({ cancelled: true }));
  busy(runs);

  assert.equal(admit(engine, delivered, "preempt", "restart").action, "held");
  assert.deepEqual(delivered, []);

  runs.settleOpenFor(SESSION, PARTICIPANT, "cancelled");

  assert.deepEqual(delivered, ["restart"]);
});

test("preempt whose cancel settles synchronously delivers now", () => {
  // A2A's shape: `cancel` settles the Run before returning, so the participant is
  // idle and the restart can go immediately.
  const runs = new RunRegistry(new InMemoryRunStore());
  const cancel: CancelRun = (request: RunCancellation): CancelResult => {
    runs.settleOpenFor(request.sessionId, request.participantId, "cancelled");
    return { cancelled: true };
  };
  const engine = new AdmissionEngine(runs, cancel);
  runs.useOnSettled((run) => engine.release(run));
  const delivered: string[] = [];
  busy(runs);

  const decision = engine.admit({
    sessionId: SESSION,
    participantId: PARTICIPANT,
    conversationId: CONVERSATION,
    policy: "preempt",
    waveDepth: 0,
    deliver: () => delivered.push("restart"),
  });
  if (decision.action === "now") delivered.push("restart");

  assert.equal(decision.action, "now");
  assert.deepEqual(delivered, ["restart"]);
});

test("preempt refuses when nothing can be cancelled, emitting a cause", () => {
  const { runs, engine, delivered } = makeEngine(() => ({
    cancelled: false,
    reason: "no cancel protocol",
  }));
  busy(runs);

  const decision = admit(engine, delivered, "preempt", "restart");

  assert.equal(decision.action, "rejected");
  assert.equal(
    decision.action === "rejected" && decision.cause.kind,
    "admission-rejected",
  );
  assert.equal(
    decision.action === "rejected" &&
      decision.cause.kind === "admission-rejected" &&
      decision.cause.policy,
    "preempt",
  );
  assert.deepEqual(delivered, []);
});

test("reject refuses a mid-Run wake with a cause", () => {
  const { runs, engine, delivered } = makeEngine();
  busy(runs);

  const decision = admit(engine, delivered, "reject", "no");

  assert.equal(decision.action, "rejected");
  assert.equal(
    decision.action === "rejected" &&
      decision.cause.kind === "admission-rejected" &&
      decision.cause.policy,
    "reject",
  );
  assert.deepEqual(delivered, []);
});

test("a participant releases held wakes only once it is idle again", () => {
  const { runs, engine, delivered } = makeEngine();
  busy(runs);
  admit(engine, delivered, "coalesce", "held");

  // Settling a different participant's Run must not fire this one's wake.
  runs.open({
    sessionId: SESSION,
    participantId: "other",
    ingress: "reaction",
  });
  runs.settleOpenFor(SESSION, "other", "completed");
  assert.deepEqual(delivered, []);

  runs.settleOpenFor(SESSION, PARTICIPANT, "completed");
  assert.deepEqual(delivered, ["held"]);
});

test("admission is per Membership: the same agent queues in one, coalesces in another", () => {
  const { runs, engine, delivered } = makeEngine();
  busy(runs);

  assert.equal(admit(engine, delivered, "queue", "a", "conv-a").action, "now");
  assert.equal(
    admit(engine, delivered, "coalesce", "b", "conv-b").action,
    "held",
  );

  assert.deepEqual(delivered, ["a"]);
  assert.equal(engine.depthFor(SESSION, PARTICIPANT), 1);
  assert.deepEqual(engine.listForSession(SESSION), [
    { participantId: PARTICIPANT, conversationId: "conv-b" },
  ]);
});
