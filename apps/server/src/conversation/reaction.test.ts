import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatMessage } from "@tangent/shared/contracts.ts";

import type { MessageFacts } from "./reaction.ts";
import { messageFacts, parseReaction, reactionSpec } from "./reaction.ts";
import { fromReaction } from "./reactor.ts";

/** Envelope facts with sane defaults, overridable per field. */
function facts(overrides: Partial<MessageFacts> = {}): MessageFacts {
  return {
    conversationId: "prime",
    seq: 1,
    authorId: "user@example.com",
    sourceKind: "human",
    mentions: [],
    endsRun: false,
    ...overrides,
  };
}

test("fromHumans reacts to a person and to nothing else", () => {
  const reacts = parseReaction("fromHumans");

  assert.equal(reacts(facts(), "prime"), true);
  assert.equal(reacts(facts({ sourceKind: "agent" }), "prime"), false);
  assert.equal(reacts(facts({ sourceKind: "system" }), "prime"), false);
});

test("mentionsMe is addressing, not name matching", () => {
  const reacts = parseReaction("mentionsMe");

  assert.equal(reacts(facts({ mentions: ["prime"] }), "prime"), true);
  assert.equal(reacts(facts({ mentions: ["sub-1"] }), "prime"), false);
  // The body is never consulted: only the envelope's mention list counts.
  assert.equal(reacts(facts({ mentions: [] }), "prime"), false);
});

test("atRunEnd reacts to a finalized turn only", () => {
  const reacts = parseReaction("atRunEnd");

  assert.equal(
    reacts(facts({ sourceKind: "agent", endsRun: true }), "p"),
    true,
  );
  assert.equal(reacts(facts({ sourceKind: "agent" }), "p"), false);
});

test("a spec is the disjunction of the presets it names", () => {
  const reacts = parseReaction(reactionSpec("atRunEnd", "mentionsMe"));

  assert.equal(
    reacts(facts({ sourceKind: "agent", endsRun: true }), "p"),
    true,
  );
  assert.equal(reacts(facts({ mentions: ["p"] }), "p"), true);
  assert.equal(reacts(facts({ sourceKind: "agent" }), "p"), false);
});

test("an unreadable spec never reacts", () => {
  // A spec written by a newer server, or corrupted: inventing a reaction for a
  // value we cannot read is how an unintended cascade starts.
  assert.equal(parseReaction("whenTheMoonIsFull")(facts(), "p"), false);
  assert.equal(parseReaction("")(facts(), "p"), false);
  // A recognizable token still counts alongside one we cannot read.
  assert.equal(parseReaction("nonsense+fromHumans")(facts(), "p"), true);
});

test("never refuses what always accepts", () => {
  assert.equal(
    parseReaction("always")(facts({ sourceKind: "system" }), "p"),
    true,
  );
  assert.equal(parseReaction("never")(facts(), "p"), false);
});

test("a stateless reaction is exactly its Reactor form", () => {
  // Section 4.1's predicate is Reactor<void>: fold the one Message and test it.
  // The two must agree for every spec, or wrapping would change delivery.
  const specs = [
    "fromHumans",
    "mentionsMe",
    "atRunEnd",
    "always",
    "never",
    "atRunEnd+mentionsMe",
  ];
  const cases: Partial<MessageFacts>[] = [
    {},
    { sourceKind: "agent", endsRun: true },
    { mentions: ["p"] },
    { sourceKind: "system" },
    { sourceKind: "agent", endsRun: true, mentions: ["p"] },
  ];
  for (const spec of specs) {
    for (const override of cases) {
      const f = facts(override);
      const direct = parseReaction(spec)(f, "p");
      const reactor = fromReaction(spec, "p");
      const viaReactor = reactor.ready(
        reactor.observe(reactor.initial, f, "p"),
      );
      assert.equal(
        viaReactor,
        direct,
        `${spec} on ${JSON.stringify(override)}`,
      );
    }
  }
});

test("messageFacts exposes the envelope and not the body", () => {
  const message: ChatMessage = {
    id: "m1",
    sessionId: "s1",
    conversationId: "sub-1",
    seq: 7,
    author: {
      id: "sub-1",
      kind: "agent",
      name: "Worker",
      agentRole: "subagent",
    },
    source: { kind: "agent", from: "sub-1" },
    mentions: ["prime"],
    content: "@prime please review",
    endsRun: true,
    runId: "run-1",
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  assert.deepEqual(messageFacts(message), {
    conversationId: "sub-1",
    seq: 7,
    authorId: "sub-1",
    sourceKind: "agent",
    sourceFrom: "sub-1",
    mentions: ["prime"],
    endsRun: true,
    runId: "run-1",
    cause: undefined,
  });
});
