import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ChatAuthor,
  ChatMessage,
  MessageSourceKind,
} from "@tangent/shared/contracts.ts";

import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import type { DeliveryRequest, DeliveryResult } from "../connectors/types.ts";
import type { Membership } from "../store/membershipStore.ts";
import { FanOutEngine } from "./fanOut.ts";
import type { MembershipRegistry } from "./membershipRegistry.ts";

const HUMAN: ChatAuthor = { id: "ada@x", kind: "human", name: "Ada" };
const PRIME: ChatAuthor = {
  id: "prime",
  kind: "agent",
  name: "Prime",
  agentRole: "prime",
};
const WORKER: ChatAuthor = {
  id: "sub-1",
  kind: "agent",
  name: "Worker",
  agentRole: "subagent",
};

let counter = 0;

/** A persisted Message, with the envelope fields the engine reads. */
function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  counter += 1;
  const author = overrides.author ?? HUMAN;
  const kind: MessageSourceKind =
    author.id === "system" ? "system" : author.kind;
  return {
    id: `m${counter}`,
    sessionId: "s1",
    conversationId: "prime",
    seq: counter,
    author,
    source: { kind },
    mentions: [],
    content: "hello",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function membership(
  participantId: string,
  conversationId: string,
  reaction: string,
): Membership {
  return {
    sessionId: "s1",
    participantId,
    conversationId,
    reaction,
    ingress: "reaction",
    transcriptVisibility: "shared",
  };
}

/** A refused delivery, phrased the way a connector phrases one. */
const REFUSED: DeliveryResult = {
  delivered: false,
  reason: "That agent isn't reachable.",
};

/**
 * An engine over a fixed membership table and a recording connector registry.
 * `deliver` is what "who was woken" is measured by, and `notices` is what the
 * conversation was told about anything the engine stopped.
 */
function makeEngine(
  rows: Membership[],
  refuse: (participantId: string) => boolean = () => false,
) {
  const delivered: DeliveryRequest[] = [];
  const notices: { conversationId: string; text: string }[] = [];

  const memberships = {
    membersOf: async (_sessionId: string, conversationId: string) =>
      rows.filter((row) => row.conversationId === conversationId),
  } as unknown as MembershipRegistry;

  const connectors = {
    resolve: (_sessionId: string, participantId: string) => ({
      deliver: (request: DeliveryRequest): DeliveryResult => {
        if (refuse(participantId)) return REFUSED;
        delivered.push(request);
        return { delivered: true };
      },
    }),
  } as unknown as ConnectorRegistry;

  const engine = new FanOutEngine(
    memberships,
    () => connectors,
    (_sessionId, conversationId, text) =>
      notices.push({ conversationId, text }),
  );

  return { engine, delivered, notices };
}

/** The plain projection: what a recipient reads is not what this test is about. */
const project = (msg: ChatMessage) => msg.content;

test("a human message wakes the participant whose conversation it is", async () => {
  const h = makeEngine([membership("prime", "prime", "fromHumans+mentionsMe")]);

  const result = await h.engine.fanOut({ message: message(), project });

  assert.deepEqual(result.woke, ["prime"]);
  assert.deepEqual(
    h.delivered.map((d) => d.participantId),
    ["prime"],
  );
});

test("a participant never reacts to its own message", async () => {
  const h = makeEngine([membership("prime", "prime", "always")]);

  const result = await h.engine.fanOut({
    message: message({ author: PRIME }),
    project,
  });

  assert.deepEqual(result.woke, []);
  assert.deepEqual(h.notices, []);
});

test("a finalized sub-agent turn wakes the orchestrator watching its conversation", async () => {
  const h = makeEngine([
    membership("sub-1", "sub-1", "fromHumans+mentionsMe"),
    membership("prime", "sub-1", "atRunEnd+mentionsMe"),
  ]);

  const result = await h.engine.fanOut({
    message: message({
      conversationId: "sub-1",
      author: WORKER,
      endsRun: true,
      source: { kind: "agent", from: "sub-1" },
    }),
    project,
  });

  assert.deepEqual(result.woke, ["prime"]);
});

test("a system notice provokes nothing", async () => {
  const h = makeEngine([membership("prime", "prime", "always")]);

  const result = await h.engine.fanOut({
    message: message({
      author: { id: "system", kind: "agent", name: "System" },
      source: { kind: "system" },
    }),
    project,
  });

  assert.deepEqual(result.woke, []);
  assert.deepEqual(h.notices, [], "a notice about a stop cannot cause one");
});

test("a mentioned participant that does not react is said to have refused", async () => {
  const h = makeEngine([
    membership("sub-1", "sub-1", "never"),
    membership("prime", "sub-1", "mentionsMe"),
  ]);

  const result = await h.engine.fanOut({
    message: message({
      conversationId: "sub-1",
      author: PRIME,
      mentions: ["sub-1"],
    }),
    project,
  });

  assert.deepEqual(result.woke, []);
  assert.deepEqual(result.refused, [
    {
      participantId: "sub-1",
      reason:
        "This agent doesn't react to messages here, so nothing was delivered.",
    },
  ]);
  assert.equal(h.notices.length, 1, "the refusal is visible in the thread");
  assert.equal(h.notices[0].conversationId, "sub-1");
});

test("a participant that ignores a message it was not addressed by stays silent", async () => {
  const h = makeEngine([
    membership("sub-1", "sub-1", "never"),
    membership("prime", "sub-1", "mentionsMe"),
  ]);

  const result = await h.engine.fanOut({
    message: message({ conversationId: "sub-1", author: PRIME }),
    project,
  });

  assert.deepEqual(result.refused, []);
  assert.deepEqual(
    h.notices,
    [],
    "not reacting is only news if you were asked",
  );
});

test("a connector's refusal reaches the sender instead of reading as success", async () => {
  const h = makeEngine(
    [membership("prime", "prime", "always")],
    (participantId) => participantId === "prime",
  );

  const result = await h.engine.fanOut({ message: message(), project });

  assert.deepEqual(result.woke, []);
  assert.deepEqual(result.refused, [
    { participantId: "prime", reason: REFUSED.reason },
  ]);
});

test("a cycle of reactions stops at the depth limit, and says why once", async () => {
  // Two participants that each react to everything the other says: without the
  // engine's wave budget this never terminates.
  const h = makeEngine([
    membership("b", "a", "always"),
    membership("a", "b", "always"),
  ]);

  let author = { ...WORKER, id: "a", name: "A" };
  let conversationId = "a";
  for (let hop = 0; hop < 20; hop += 1) {
    const result = await h.engine.fanOut({
      message: message({ conversationId, author, endsRun: true }),
      project,
    });
    if (result.woke.length === 0) break;
    const next = result.woke[0];
    author = { ...WORKER, id: next, name: next };
    conversationId = next;
  }

  assert.equal(h.delivered.length, 8, "the chain runs to the hop limit");
  assert.equal(h.notices.length, 1, "and announces the stop exactly once");
  assert.match(h.notices[0].text, /reached its limit of 8 hops/);
});

test("deliberate work starts a fresh chain instead of inheriting one", async () => {
  const h = makeEngine([
    membership("b", "a", "always"),
    membership("a", "b", "always"),
  ]);

  // Run one chain to exhaustion, then post as a tool call: a long orchestration
  // driven by explicit tool calls must not be cut short by an earlier cascade.
  let author = { ...WORKER, id: "a", name: "A" };
  let conversationId = "a";
  for (let hop = 0; hop < 20; hop += 1) {
    const result = await h.engine.fanOut({
      message: message({ conversationId, author, endsRun: true }),
      project,
    });
    if (result.woke.length === 0) break;
    conversationId = result.woke[0];
    author = { ...WORKER, id: conversationId, name: conversationId };
  }
  const spent = h.delivered.length;

  const result = await h.engine.fanOut({
    message: message({ conversationId: "a", author: PRIME }),
    ingress: "tool",
    project,
  });

  assert.deepEqual(result.woke, ["b"]);
  assert.equal(h.delivered.length, spent + 1);
});

test("fan-out of one conversation is dispatched in the order posted", async () => {
  const h = makeEngine([membership("prime", "prime", "always")]);

  await Promise.all([
    h.engine.fanOut({ message: message({ content: "first" }), project }),
    h.engine.fanOut({ message: message({ content: "second" }), project }),
    h.engine.fanOut({ message: message({ content: "third" }), project }),
  ]);

  assert.deepEqual(
    h.delivered.map((d) => d.text),
    ["first", "second", "third"],
  );
});

test("a post carries its ingress to the run it opens, over the membership's", async () => {
  const h = makeEngine([membership("prime", "prime", "always")]);

  await h.engine.fanOut({ message: message(), project });
  await h.engine.fanOut({ message: message(), ingress: "schedule", project });

  assert.deepEqual(
    h.delivered.map((d) => d.ingress),
    ["reaction", "schedule"],
  );
});
