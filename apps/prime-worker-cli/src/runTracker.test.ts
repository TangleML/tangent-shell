import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import { RunTracker } from "./runTracker.ts";

const SETTLE_MS = 1_500;
const NOT_ACCEPTED_MS = 30_000;

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

function tracker() {
  const log: string[] = [];
  const runs = new RunTracker(
    () => log.push("start"),
    (reply) => log.push(`end:${reply}`),
  );
  return { runs, log };
}

test("a run ends after the settle delay, with every message", () => {
  const { runs, log } = tracker();
  runs.messageSent();
  runs.status("busy");
  runs.primeMessageStarted("m1");
  runs.primeMessageEnded("m1", "Looking.");
  runs.primeMessageStarted("m2");
  runs.primeMessageEnded("m2", "Found 3 files.");
  runs.status("active");
  assert.deepEqual(log, ["start"]);
  mock.timers.tick(SETTLE_MS);
  assert.deepEqual(log, ["start", "end:Looking.\n\nFound 3 files."]);
  assert.equal(runs.isRunning, false);
});

test("a busy status inside the settle delay keeps the run going", () => {
  const { runs, log } = tracker();
  runs.messageSent();
  runs.status("busy");
  runs.status("active");
  mock.timers.tick(SETTLE_MS - 1);
  runs.status("busy");
  runs.primeMessageEnded("late", "Second run.");
  runs.status("active");
  mock.timers.tick(SETTLE_MS);
  assert.deepEqual(log, ["start", "end:Second run."]);
});

test("active before busy does not end the run", () => {
  const { runs, log } = tracker();
  runs.messageSent();
  runs.status("active");
  mock.timers.tick(SETTLE_MS);
  assert.deepEqual(log, ["start"]);
});

test("joining a session that is already busy starts a run", () => {
  const { runs, log } = tracker();
  runs.status("busy");
  runs.status("idle");
  mock.timers.tick(SETTLE_MS);
  assert.deepEqual(log, ["start", "end:"]);
});

test("statuses outside a run are ignored", () => {
  const { runs, log } = tracker();
  runs.status("active");
  runs.status("idle");
  mock.timers.tick(SETTLE_MS);
  assert.deepEqual(log, []);
});

test("a run waits for a message that finishes after the settle delay", () => {
  const { runs, log } = tracker();
  runs.messageSent();
  runs.status("busy");
  runs.primeMessageStarted("late");
  runs.status("active");
  mock.timers.tick(SETTLE_MS);
  assert.deepEqual(log, ["start"]);
  runs.primeMessageEnded("late", "WORKER OK");
  assert.deepEqual(log, ["start", "end:WORKER OK"]);
});

test("an error for Prime's message ends the run; another agent's does not", () => {
  const { runs, log } = tracker();
  runs.messageSent();
  runs.primeMessageStarted("m3");
  runs.primeMessageEnded("m3", "Partial");
  runs.primeMessageStarted("m4");
  runs.failed("sub-agent crashed", "other-agent-message");
  assert.deepEqual(log, ["start"]);
  runs.failed("model unavailable", "m4");
  assert.deepEqual(log, [
    "start",
    "end:Partial\n\nPrime error: model unavailable",
  ]);
});

test("a message that never makes Prime busy ends with an error", () => {
  const { runs, log } = tracker();
  runs.messageSent();
  mock.timers.tick(NOT_ACCEPTED_MS);
  assert.deepEqual(log, [
    "start",
    "end:Prime error: the message was not accepted",
  ]);
});

test("any non-idle status stops the not-accepted watchdog", () => {
  const { runs, log } = tracker();
  runs.messageSent();
  runs.status("active");
  mock.timers.tick(NOT_ACCEPTED_MS);
  assert.deepEqual(log, ["start"]);
});

test("sending while the session is already busy does not arm the watchdog", () => {
  const { runs, log } = tracker();
  runs.messageSent();
  runs.status("busy");
  runs.failed("first run failed");
  runs.messageSent();
  mock.timers.tick(NOT_ACCEPTED_MS);
  assert.deepEqual(log, [
    "start",
    "end:Prime error: first run failed",
    "start",
  ]);
});

test("a lost connection always puts a warning before the reply", () => {
  const { runs, log } = tracker();
  runs.messageSent();
  runs.status("busy");
  runs.primeMessageStarted("m5");
  runs.disconnected();
  runs.primeMessageEnded("m6", "Second half.");
  runs.status("idle");
  mock.timers.tick(SETTLE_MS);
  assert.match(log[1] ?? "", /^end:\(Warning: .*web UI\.\)\n\nSecond half\.$/);
});
