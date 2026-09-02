import assert from "node:assert/strict";
import { test } from "node:test";

import {
  capabilitiesForRole,
  type TerminationCause,
} from "@tangent/shared/contracts.ts";

import { describeCause } from "./causes.ts";

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

test("prime carries the supervisor capability, a sub-agent none", () => {
  assert.deepEqual(capabilitiesForRole("prime"), [
    "orchestrator",
    "supervisor",
  ]);
  assert.deepEqual(capabilitiesForRole("subagent"), []);
});
