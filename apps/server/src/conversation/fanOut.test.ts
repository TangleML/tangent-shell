import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  AdmissionPolicy,
  ChatAuthor,
  ChatMessage,
  MessageSourceKind,
  TerminationCause,
} from "@tangent/shared/contracts.ts";

import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import type { DeliveryRequest, DeliveryResult } from "../connectors/types.ts";
import { InMemoryReactorStore } from "../store/inMemoryReactorStore.ts";
import type { Membership } from "../store/membershipStore.ts";
import { FanOutEngine } from "./fanOut.ts";
import type { MembershipRegistry } from "./membershipRegistry.ts";
import { ReactorRegistry } from "./reactorRegistry.ts";

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
  admission: AdmissionPolicy = "queue",
): Membership {
  return {
    sessionId: "s1",
    participantId,
    conversationId,
    reaction,
    ingress: "reaction",
    admission,
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
  const notices: {
    conversationId: string;
    text: string;
    cause: TerminationCause;
  }[] = [];

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
    (_sessionId, conversationId, text, cause) =>
      notices.push({ conversationId, text, cause }),
  );

  return { engine, delivered, notices };
}

/** The same engine, but with a live reactor registry wired to its wake delivery,
 * so a fan-in is exercised end to end: install, observe, then wake in home. */
function makeEngineWithReactors(rows: Membership[]) {
  const delivered: DeliveryRequest[] = [];
  const notices: {
    conversationId: string;
    text: string;
    cause: TerminationCause;
  }[] = [];

  const memberships = {
    membersOf: async (_sessionId: string, conversationId: string) =>
      rows.filter((row) => row.conversationId === conversationId),
  } as unknown as MembershipRegistry;

  const connectors = {
    resolve: () => ({
      deliver: (request: DeliveryRequest): DeliveryResult => {
        delivered.push(request);
        return { delivered: true };
      },
    }),
  } as unknown as ConnectorRegistry;

  const reactors = new ReactorRegistry(new InMemoryReactorStore());
  const engine = new FanOutEngine(
    memberships,
    () => connectors,
    (_sessionId, conversationId, text, cause) =>
      notices.push({ conversationId, text, cause }),
    reactors,
  );
  reactors.useDelivery((wake) => engine.wakeReactor(wake));
  return { engine, reactors, delivered, notices };
}

/** The plain projection: what a recipient reads is not what this test is about. */
const project = (msg: ChatMessage) => msg.content;

/** A worker finishing its turn in its own thread — a completion the join folds. */
function finished(who: string, conversationId: string): ChatMessage {
  return message({
    conversationId,
    author: { id: who, kind: "agent", name: who, agentRole: "subagent" },
    source: { kind: "agent", from: who },
    endsRun: true,
    content: "done",
  });
}

/** The system notice the roster handler posts when a worker's connection drops:
 * a connector-detached cause in the worker's own home conversation. */
function detached(who: string, conversationId: string): ChatMessage {
  return message({
    conversationId,
    author: { id: "system", kind: "agent", name: "System" },
    source: { kind: "system" },
    content: "This agent's connection dropped.",
    cause: {
      kind: "connector-detached",
      participantId: who,
      conversationId,
      waveDepth: 0,
    },
  });
}

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

test("a muted membership never reacts, whatever its reaction says", async () => {
  const h = makeEngine([
    { ...membership("observer", "room", "always"), muted: true },
  ]);

  const result = await h.engine.fanOut({
    message: message({ conversationId: "room" }),
    project,
  });

  assert.deepEqual(result.woke, []);
  assert.deepEqual(h.delivered, []);
});

test("a shared room delivers by predicate to heterogeneous members", async () => {
  // One Conversation holding two humans, an orchestrator, an opaque A2A peer,
  // an observer that follows everything, and a compliance member that only
  // contributes. Each predicate decides for itself whether its Participant runs.
  const room = "room";
  const h = makeEngine([
    membership("prime", room, "fromHumans+mentionsMe"),
    membership("ada@x", room, "never"),
    membership("ben@x", room, "never"),
    membership("peer-1", room, "mentionsMe"),
    membership("observer", room, "always"),
    membership("audit", room, "never"),
  ]);

  const result = await h.engine.fanOut({
    message: message({
      conversationId: room,
      author: { id: "ben@x", kind: "human", name: "Ben" },
      mentions: ["peer-1"],
    }),
    project,
  });

  // The peer wakes because it was addressed; the orchestrator because a human
  // spoke; the observer because it follows every Message. The other human and
  // the compliance member never react.
  assert.deepEqual(result.woke.sort(), ["observer", "peer-1", "prime"]);
});

test("an unaddressed human message leaves the mentions-only members asleep", async () => {
  const room = "room";
  const h = makeEngine([
    membership("prime", room, "fromHumans+mentionsMe"),
    membership("peer-1", room, "mentionsMe"),
    membership("observer", room, "always"),
    membership("audit", room, "never"),
  ]);

  const result = await h.engine.fanOut({
    message: message({ conversationId: room }),
    project,
  });

  // No mention: the specialist / opaque peer stays asleep. Only the
  // orchestrator (a human spoke) and the observer (follows everything) wake.
  assert.deepEqual(result.woke.sort(), ["observer", "prime"]);
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

test("mid-wave reaction-budget exhaustion refuses only the members left without a slot", async () => {
  // More members react in one Conversation than a single wave may dispatch to.
  const room = "room";
  const rows: Membership[] = [];
  for (let n = 0; n < 26; n += 1)
    rows.push(membership(`m${n}`, room, "always"));
  const h = makeEngine(rows);

  const result = await h.engine.fanOut({
    message: message({ conversationId: room }),
    project,
  });

  // The first 24 are delivered; the 25th trips the per-Conversation budget, so
  // only it and the 26th are refused — never a member already in `woke`.
  assert.equal(result.woke.length, 24);
  assert.deepEqual(
    result.refused.map((r) => r.participantId),
    ["m24", "m25"],
  );
  const wokeSet = new Set(result.woke);
  const overlap = result.refused.filter((r) => wokeSet.has(r.participantId));
  assert.deepEqual(overlap, [], "no participant is both woke and refused");
});

test("a settled chain's wave is evicted, so the workflow view stops reporting it", async () => {
  const h = makeEngine([membership("prime", "prime", "fromHumans+mentionsMe")]);

  await h.engine.fanOut({ message: message(), project });
  assert.deepEqual(
    h.engine.listForSession("s1").map((w) => w.participantId),
    ["prime"],
    "the woken participant holds a chain",
  );
  assert.equal(h.engine.waveDepth("s1", "prime"), 1);

  h.engine.evictWave("s1", "prime");

  assert.deepEqual(h.engine.listForSession("s1"), []);
  assert.equal(h.engine.waveDepth("s1", "prime"), 0);
});

test("evicting one rider keeps a wave its co-reactors still hold", async () => {
  const room = "room";
  const h = makeEngine([
    membership("a", room, "always"),
    membership("b", room, "always"),
  ]);

  await h.engine.fanOut({
    message: message({ conversationId: room }),
    project,
  });
  assert.equal(h.engine.listForSession("s1").length, 2);

  h.engine.evictWave("s1", "a");

  assert.deepEqual(
    h.engine.listForSession("s1").map((w) => w.participantId),
    ["b"],
    "b's chain survives a's settle",
  );
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
  for (let hop = 0; hop < 40; hop += 1) {
    const result = await h.engine.fanOut({
      message: message({ conversationId, author, endsRun: true }),
      project,
    });
    if (result.woke.length === 0) break;
    const next = result.woke[0];
    author = { ...WORKER, id: next, name: next };
    conversationId = next;
  }

  assert.equal(h.delivered.length, 24, "the chain runs to the hop limit");
  assert.equal(h.notices.length, 1, "and announces the stop exactly once");
  assert.match(h.notices[0].text, /reached its limit of 24 hops/);
  // The notice carries the structured cause, attributed, so a supervisor can act
  // on it rather than parse the sentence.
  const cause = h.notices[0].cause;
  assert.equal(cause.kind, "budget-exhausted");
  assert.equal(cause.kind === "budget-exhausted" && cause.budget, "wave-depth");
  assert.equal(cause.kind === "budget-exhausted" && cause.limit, 24);
  assert.equal(cause.conversationId, h.notices[0].conversationId);
  assert.equal(typeof cause.waveDepth, "number");
});

test("a cycle that changes rooms on every hop is bounded just the same", async () => {
  // Each hop is a deliberate tool call, which on its own starts a fresh chain.
  // Because each one is also written from the author's own conversation, the
  // chain travels with it — otherwise this pair launders an unbounded cycle by
  // taking turns in each other's rooms while neither room fills its budget.
  const h = makeEngine([
    membership("a", "a", "always"),
    membership("b", "b", "always"),
  ]);

  let author = { ...WORKER, id: "a", name: "A" };
  for (let hop = 0; hop < 40; hop += 1) {
    const target = author.id === "a" ? "b" : "a";
    const result = await h.engine.fanOut({
      message: message({
        conversationId: target,
        author,
        source: { kind: "relay", from: author.id, fromConversation: author.id },
      }),
      ingress: "tool",
      project,
    });
    if (result.woke.length === 0) break;
    author = { ...WORKER, id: result.woke[0], name: result.woke[0] };
  }

  assert.equal(
    h.delivered.length,
    24,
    "hopping rooms does not reset the chain",
  );
  assert.equal(h.notices.length, 1);
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
  for (let hop = 0; hop < 40; hop += 1) {
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

test("a fan-in wakes once, in its home, only after every worker finishes", async () => {
  // The orchestrator holds a membership in each worker thread set to mentionsMe,
  // so a completion alone wakes nobody by predicate — the join is what waits.
  const h = makeEngineWithReactors([
    membership("prime", "B1", "mentionsMe"),
    membership("prime", "B2", "mentionsMe"),
    membership("prime", "B3", "mentionsMe"),
  ]);
  await h.reactors.install({
    sessionId: "s1",
    participantId: "prime",
    spec: { name: "awaitAll", participants: ["w1", "w2", "w3"] },
    scope: {
      memberships: [
        { conversationId: "B1", participantId: "prime" },
        { conversationId: "B2", participantId: "prime" },
        { conversationId: "B3", participantId: "prime" },
      ],
      homeConversationId: "A",
    },
  });

  await h.engine.fanOut({ message: finished("w1", "B1"), project });
  await h.engine.fanOut({ message: finished("w2", "B2"), project });
  assert.equal(h.delivered.length, 0, "two of three is still pending");

  await h.engine.fanOut({ message: finished("w3", "B3"), project });
  assert.equal(h.delivered.length, 1, "the completed set wakes exactly once");
  assert.equal(h.delivered[0].participantId, "prime");
  assert.equal(
    h.delivered[0].conversationId,
    "A",
    "in the declared home, not whichever worker thread finished last",
  );
});

test("a detached worker mid-join wakes a supervisor while the join stays pending", async () => {
  // The working-at-end claim: awaitAll and supervise share the three worker
  // threads. Two workers finish; the third's connection drops. The supervisor
  // must get something to act on, and the join must stay unfinished.
  const h = makeEngineWithReactors([
    membership("prime", "B1", "mentionsMe"),
    membership("prime", "B2", "mentionsMe"),
    membership("prime", "B3", "mentionsMe"),
  ]);
  const scope = {
    memberships: [
      { conversationId: "B1", participantId: "prime" },
      { conversationId: "B2", participantId: "prime" },
      { conversationId: "B3", participantId: "prime" },
    ],
    homeConversationId: "A",
  };
  const join = await h.reactors.install({
    sessionId: "s1",
    participantId: "prime",
    spec: { name: "awaitAll", participants: ["w1", "w2", "w3"] },
    scope,
  });
  await h.reactors.install({
    sessionId: "s1",
    participantId: "prime",
    spec: { name: "supervise" },
    scope,
  });

  await h.engine.fanOut({ message: finished("w1", "B1"), project });
  await h.engine.fanOut({ message: finished("w2", "B2"), project });
  assert.equal(h.delivered.length, 0, "two completions wake no one yet");

  await h.engine.fanOut({ message: detached("w3", "B3"), project });

  assert.equal(h.delivered.length, 1, "the supervisor wakes on the failure");
  assert.equal(h.delivered[0].participantId, "prime");
  assert.equal(h.delivered[0].conversationId, "A", "in its home, not B3");
  assert.match(h.delivered[0].text, /connector-detached/);
  assert.match(h.delivered[0].text, /B3/);
  assert.equal(
    (await h.reactors.inspect(join.id))?.ready,
    false,
    "the join still waits on the third worker",
  );
});

test("an addressing message wakes a member while its join stays pending", async () => {
  const h = makeEngineWithReactors([
    membership("prime", "B1", "mentionsMe"),
    membership("prime", "B2", "mentionsMe"),
    membership("prime", "B3", "mentionsMe"),
  ]);
  const installed = await h.reactors.install({
    sessionId: "s1",
    participantId: "prime",
    spec: { name: "awaitAll", participants: ["w1", "w2", "w3"] },
    scope: {
      memberships: [
        { conversationId: "B1", participantId: "prime" },
        { conversationId: "B2", participantId: "prime" },
        { conversationId: "B3", participantId: "prime" },
      ],
      homeConversationId: "A",
    },
  });

  await h.engine.fanOut({ message: finished("w1", "B1"), project });

  // W3 asks a clarifying question — not a completion — that names the orchestrator.
  await h.engine.fanOut({
    message: message({
      conversationId: "B3",
      author: { id: "w3", kind: "agent", name: "w3", agentRole: "subagent" },
      source: { kind: "agent", from: "w3" },
      mentions: ["prime"],
      content: "which region?",
    }),
    project,
  });

  assert.deepEqual(
    h.delivered.map((d) => d.conversationId),
    ["B3"],
    "the clarifying wake lands in the worker thread, independent of the join",
  );
  const view = await h.reactors.inspect(installed.id);
  assert.equal(view?.ready, false, "and the join is still waiting on 2 of 3");
});
