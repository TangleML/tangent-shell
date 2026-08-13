import assert from "node:assert/strict";
import { test } from "node:test";

import { PresenceTracker } from "./presenceTracker.ts";

test("arrive is true only on the first socket, depart only on the last", () => {
  const tracker = new PresenceTracker();

  assert.equal(tracker.arrive("s", "p"), true, "first socket connects them");
  assert.equal(tracker.arrive("s", "p"), false, "a second tab is not a change");
  assert.equal(tracker.depart("s", "p"), false, "one tab remains open");
  assert.equal(tracker.depart("s", "p"), true, "the last tab detaches them");
});

test("presence is refcounted per (session, participant)", () => {
  const tracker = new PresenceTracker();

  assert.equal(tracker.arrive("s1", "p"), true);
  assert.equal(
    tracker.arrive("s2", "p"),
    true,
    "a different session is separate",
  );
  assert.equal(tracker.depart("s1", "p"), true);
  assert.equal(tracker.arrive("s1", "p"), true, "and reconnects independently");
});

test("departing an untracked participant does not underflow the count", () => {
  const tracker = new PresenceTracker();

  assert.equal(tracker.depart("s", "ghost"), true);
  assert.equal(
    tracker.arrive("s", "ghost"),
    true,
    "the next arrive is still first",
  );
});
