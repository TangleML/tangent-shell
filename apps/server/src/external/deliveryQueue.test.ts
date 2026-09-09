import assert from "node:assert/strict";
import { test } from "node:test";

import { DeliveryQueue } from "./deliveryQueue.ts";

test("queued work is answered without waiting", async () => {
  const queue = new DeliveryQueue();
  queue.push("s1", { agentId: "ext-1", text: "go" });
  queue.push("s1", { agentId: "ext-2", text: "also go" });

  assert.deepEqual(await queue.take("s1", 5_000), [
    { agentId: "ext-1", text: "go" },
    { agentId: "ext-2", text: "also go" },
  ]);
});

test("a taken batch is not handed out twice", async () => {
  const queue = new DeliveryQueue();
  queue.push("s1", { agentId: "ext-1", text: "go" });

  await queue.take("s1", 5_000);

  assert.deepEqual(await queue.take("s1", 5), []);
});

test("a parked poll is resolved by the next delivery", async () => {
  const queue = new DeliveryQueue();
  const polled = queue.take("s1", 5_000);

  queue.push("s1", { agentId: "ext-1", text: "go" });

  assert.deepEqual(await polled, [{ agentId: "ext-1", text: "go" }]);
});

test("a poll with nothing to carry gives up empty", async () => {
  const queue = new DeliveryQueue();
  assert.deepEqual(await queue.take("s1", 5), []);
});

test("a delivery handed to a waiter is not left queued behind it", async () => {
  const queue = new DeliveryQueue();
  const polled = queue.take("s1", 5_000);
  queue.push("s1", { agentId: "ext-1", text: "go" });
  await polled;

  assert.deepEqual(await queue.take("s1", 5), []);
});

test("a dropped participant's work is discarded and its session mate's is not", async () => {
  const queue = new DeliveryQueue();
  queue.push("s1", { agentId: "gone", text: "lost" });
  queue.push("s1", { agentId: "ext-2", text: "kept" });

  queue.drop("s1", "gone");

  assert.deepEqual(await queue.take("s1", 5_000), [
    { agentId: "ext-2", text: "kept" },
  ]);
});

test("one session's poll never sees another session's work", async () => {
  const queue = new DeliveryQueue();
  queue.push("s2", { agentId: "ext-1", text: "theirs" });

  assert.deepEqual(await queue.take("s1", 5), []);
  assert.deepEqual(await queue.take("s2", 5_000), [
    { agentId: "ext-1", text: "theirs" },
  ]);
});
