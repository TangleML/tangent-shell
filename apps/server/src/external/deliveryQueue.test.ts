import assert from "node:assert/strict";
import { test } from "node:test";

import { DeliveryQueue } from "./deliveryQueue.ts";

test("an unscoped take collects the whole session queue", async () => {
  const queue = new DeliveryQueue();
  queue.push("s1", { agentId: "a", text: "one" });
  queue.push("s1", { agentId: "b", text: "two" });

  assert.deepEqual(await queue.take("s1", 5), [
    { agentId: "a", text: "one" },
    { agentId: "b", text: "two" },
  ]);
});

test("a scoped take drains only its agent's work", async () => {
  const queue = new DeliveryQueue();
  queue.push("s1", { agentId: "a", text: "for a" });
  queue.push("s1", { agentId: "b", text: "for b" });

  assert.deepEqual(await queue.take("s1", 5, { agentId: "a" }), [
    { agentId: "a", text: "for a" },
  ]);
  assert.deepEqual(await queue.take("s1", 5, { agentId: "b" }), [
    { agentId: "b", text: "for b" },
  ]);
});

test("a push wakes only a waiter its delivery is addressed to", async () => {
  const queue = new DeliveryQueue();
  const forB = queue.take("s1", 1_000, { agentId: "b" });
  queue.push("s1", { agentId: "a", text: "for a" });

  // The delivery for a must not wake b's poll; it waits in the queue.
  const forA = await queue.take("s1", 5, { agentId: "a" });
  assert.deepEqual(forA, [{ agentId: "a", text: "for a" }]);

  queue.push("s1", { agentId: "b", text: "for b" });
  assert.deepEqual(await forB, [{ agentId: "b", text: "for b" }]);
});

test("an unscoped waiter is woken by any delivery", async () => {
  const queue = new DeliveryQueue();
  const any = queue.take("s1", 1_000);
  queue.push("s1", { agentId: "a", text: "hi" });
  assert.deepEqual(await any, [{ agentId: "a", text: "hi" }]);
});

test("a parked scoped poll resolves with the next matching delivery", async () => {
  const queue = new DeliveryQueue();
  const parked = queue.take("s1", 1_000, { agentId: "a" });
  queue.push("s1", { agentId: "a", text: "late" });
  assert.deepEqual(await parked, [{ agentId: "a", text: "late" }]);
});

test("a poll times out empty when nothing matches", async () => {
  const queue = new DeliveryQueue();
  assert.deepEqual(await queue.take("s1", 5, { agentId: "a" }), []);
});

test("drop clears queued work and wakes a parked poll for the agent", async () => {
  const queue = new DeliveryQueue();
  const parked = queue.take("s1", 5_000, { agentId: "a" });
  queue.drop("s1", "a");
  assert.deepEqual(await parked, []);

  queue.push("s1", { agentId: "a", text: "queued" });
  queue.push("s1", { agentId: "b", text: "keep" });
  queue.drop("s1", "a");
  assert.deepEqual(await queue.take("s1", 5), [{ agentId: "b", text: "keep" }]);
});

test("an aborted take resolves empty and frees its waiter", async () => {
  const queue = new DeliveryQueue();
  const controller = new AbortController();
  const parked = queue.take("s1", 5_000, {
    agentId: "a",
    signal: controller.signal,
  });
  controller.abort();
  assert.deepEqual(await parked, []);

  // The freed slot must not swallow a later delivery for the same agent.
  queue.push("s1", { agentId: "a", text: "after" });
  assert.deepEqual(await queue.take("s1", 5, { agentId: "a" }), [
    { agentId: "a", text: "after" },
  ]);
});

test("an already-aborted signal takes immediately without parking", async () => {
  const queue = new DeliveryQueue();
  assert.deepEqual(
    await queue.take("s1", 5_000, {
      agentId: "a",
      signal: AbortSignal.abort(),
    }),
    [],
  );
});
