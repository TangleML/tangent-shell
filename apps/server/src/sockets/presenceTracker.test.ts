import assert from "node:assert/strict";
import { test } from "node:test";

import { PresenceTracker } from "./presenceTracker.ts";

test("a person is focused if any of their open tabs is focused", () => {
  const tracker = new PresenceTracker();
  assert.equal(tracker.update("s", "p", "a", false), "away");
  assert.equal(tracker.update("s", "p", "a", false), undefined);
  assert.equal(tracker.update("s", "p", "b", true), "connected");
  assert.equal(tracker.update("s", "p", "a", true), undefined);
  assert.equal(tracker.update("s", "p", "b", false), undefined);
  assert.equal(tracker.update("s", "p", "a", null), "away");
  assert.equal(tracker.update("s", "p", "b", null), "detached");
  assert.equal(tracker.update("s", "p", "b", null), undefined);
});

test("focus is independent across people and sessions", () => {
  const tracker = new PresenceTracker();
  assert.equal(tracker.update("s1", "p", "tab1", true), "connected");
  assert.equal(tracker.update("s2", "p", "tab1", false), "away");
  assert.equal(tracker.update("s1", "q", "tab2", false), "away");
  assert.equal(tracker.update("s1", "p", "tab1", null), "detached");
  assert.equal(tracker.update("s2", "p", "tab1", true), "connected");
  assert.equal(tracker.update("s1", "q", "tab2", null), "detached");
});
