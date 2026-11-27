import assert from "node:assert/strict";
import { test } from "node:test";

import {
  capabilitiesForRole,
  type TerminationCause,
} from "@tangent/shared/contracts.ts";

import {
  describeCause,
  describeRunFailure,
  MAX_RUN_FAILURE_REASON,
} from "./causes.ts";

/** The attribution every catalog kind carries, so a test says only what varies. */
const WHERE = {
  participantId: "w3",
  conversationId: "B3",
  runId: "run-9",
  waveDepth: 2,
};

test("every catalog kind describes itself, attribution and all", () => {
  const cases: [TerminationCause, RegExp][] = [
    [
      { kind: "budget-exhausted", budget: "wave-depth", limit: 24, ...WHERE },
      /reached its limit of 24 hops/,
    ],
    [
      {
        kind: "budget-exhausted",
        budget: "conversation-reactions",
        limit: 12,
        ...WHERE,
      },
      /reached its limit of 12 reactions/,
    ],
    [{ kind: "run-error", ...WHERE }, /run ended with an error/],
    [{ kind: "connector-detached", ...WHERE }, /connection dropped/],
    [
      { kind: "admission-rejected", policy: "reject", ...WHERE },
      /already working and doesn't take concurrent messages/,
    ],
    [
      { kind: "admission-rejected", policy: "preempt", ...WHERE },
      /couldn't be interrupted/,
    ],
    [
      {
        kind: "correlation-timeout",
        askedBy: "prime",
        askedOf: "w3",
        ...WHERE,
      },
      /No answer arrived in time for prime's question to w3/,
    ],
    [{ kind: "wake-refused", ...WHERE }, /doesn't react to messages here/],
  ];

  for (const [cause, matcher] of cases) {
    assert.match(describeCause(cause), matcher, cause.kind);
  }
});

test("budget-exhausted keeps the two distinct user-facing sentences", () => {
  const depth = describeCause({
    kind: "budget-exhausted",
    budget: "wave-depth",
    limit: 24,
    ...WHERE,
  });
  const reactions = describeCause({
    kind: "budget-exhausted",
    budget: "conversation-reactions",
    limit: 12,
    ...WHERE,
  });
  assert.notEqual(depth, reactions);
  assert.match(depth, /chain of reactions/);
  assert.match(reactions, /conversation reached/);
});

test("a correlation-timeout without a named recipient omits the 'to' clause", () => {
  const text = describeCause({
    kind: "correlation-timeout",
    askedBy: "prime",
    ...WHERE,
  });
  assert.match(text, /No answer arrived in time for prime's question\./);
});

test("a run-error names its reason when the settlement carried one", () => {
  const text = describeCause({
    kind: "run-error",
    reason: "TimeoutError: request timed out",
    ...WHERE,
  });
  assert.equal(
    text,
    "This agent's run ended with an error, so its work stopped without finishing. Reason: TimeoutError: request timed out",
  );
});

test("a run-error without a reason keeps the plain sentence", () => {
  assert.equal(
    describeCause({ kind: "run-error", ...WHERE }),
    "This agent's run ended with an error, so its work stopped without finishing.",
  );
});

test("a run failure reads as the error's class and message on one line", () => {
  class TimeoutError extends Error {
    override name = "TimeoutError";
  }
  assert.equal(
    describeRunFailure(new TimeoutError("stream\n  idle for 300s")),
    "TimeoutError: stream idle for 300s",
  );
  assert.equal(describeRunFailure("terminated"), "terminated");
  assert.equal(describeRunFailure(undefined), undefined);
  assert.equal(describeRunFailure("  "), undefined);
});

test("a long run failure is cut to the limit", () => {
  const reason = describeRunFailure(`Error: ${"x".repeat(2000)}`);
  assert.ok(reason);
  assert.equal(reason.length, MAX_RUN_FAILURE_REASON);
  assert.ok(reason.endsWith("\u2026"));
});

test("a run failure never carries credentials", () => {
  const leaks = [
    "sk-ant-api03-abcdefghijklmnop",
    "ghp_abcdefghijklmnopqrstuvwxyz0123",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
    "hunter2pass",
    "s3cr3tvalue",
    "AIzaSyA1234567890abcdefghijklmnopqrstu",
  ];
  const reason = describeRunFailure(
    new Error(
      `401 from https://bot:hunter2pass@llm.example/v1?key=${leaks[5]} ` +
        `Authorization: Bearer ${leaks[0]} api_key=${leaks[1]} ` +
        `{"access_token": "${leaks[2]}", "client_secret": "${leaks[4]}"}`,
    ),
  );
  assert.ok(reason);
  for (const leak of leaks) {
    assert.ok(!reason.includes(leak), `leaked ${leak}: ${reason}`);
  }
  assert.match(reason, /^Error: 401 from https:\/\/\[redacted\]@llm\.example/);
  assert.match(reason, /Bearer \[redacted\]/);
});

test("credentials are redacted before the reason is cut", () => {
  const token = `sk-${"a".repeat(600)}`;
  const reason = describeRunFailure(`Error: ${token}`);
  assert.equal(reason, "Error: [redacted]");
});

test("prime carries the supervisor capability, a sub-agent none", () => {
  assert.deepEqual(capabilitiesForRole("prime"), [
    "orchestrator",
    "supervisor",
  ]);
  assert.deepEqual(capabilitiesForRole("subagent"), []);
});
