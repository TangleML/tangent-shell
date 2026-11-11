import assert from "node:assert/strict";
import { test } from "node:test";

import { usageFromMessage } from "./utils.ts";

test("usageFromMessage lifts a full usage object onto the wire totals", () => {
  const usage = usageFromMessage({
    usage: {
      input: 100,
      output: 20,
      cacheRead: 5,
      cacheWrite: 2,
      totalTokens: 127,
      cost: { input: 0.1, output: 0.2, total: 0.0031 },
    },
  });
  assert.deepEqual(usage, {
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 5,
    cacheWriteTokens: 2,
    totalTokens: 127,
    costUsd: 0.0031,
  });
});

test("usageFromMessage returns undefined when the message carries no usage", () => {
  assert.equal(usageFromMessage(undefined), undefined);
  assert.equal(usageFromMessage({}), undefined);
});

test("usageFromMessage tolerates partial usage, defaulting missing fields to 0", () => {
  const usage = usageFromMessage({ usage: { input: 10, output: 5 } });
  assert.deepEqual(usage, {
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 15,
    costUsd: 0,
  });
});

test("usageFromMessage falls back to summing tokens when totalTokens is absent", () => {
  const usage = usageFromMessage({
    usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 5 },
  });
  assert.equal(usage?.totalTokens, 130);
});
