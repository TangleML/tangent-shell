import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  type ChatMessage,
  SYSTEM_AUTHOR,
  type TerminationCause,
} from "@tangent/shared/contracts.ts";

import { RunRegistry } from "../runs/runRegistry.ts";
import { InMemoryMembershipStore } from "../store/inMemoryMembershipStore.ts";
import { InMemoryReactorStore } from "../store/inMemoryReactorStore.ts";
import { InMemoryResourceStore } from "../store/inMemoryResourceStore.ts";
import { InMemoryRunStore } from "../store/inMemoryRunStore.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import type { Membership } from "../store/membershipStore.ts";
import { AdmissionEngine } from "./admission.ts";
import { ContextEngine } from "./context.ts";
import { CorrelationEngine } from "./correlation.ts";
import { MAX_WAVE_DEPTH } from "./fanOut.ts";
import { MembershipRegistry } from "./membershipRegistry.ts";
import type { MessageFacts } from "./reaction.ts";
import { ReactorRegistry } from "./reactorRegistry.ts";
import { ResourceCatalog } from "./resourceCatalog.ts";
import {
  type WaveReader,
  workflowView,
  type WorkflowViewDeps,
} from "./workflowView.ts";

const SESSION = "s1";

function membership(overrides: Partial<Membership>): Membership {
  return {
    sessionId: SESSION,
    participantId: "prime",
    conversationId: "home",
    reaction: "always",
    ingress: "reaction",
    admission: "queue",
    transcriptVisibility: "shared",
    ...overrides,
  };
}

function causeMessage(cause: TerminationCause): ChatMessage {
  return {
    id: randomUUID(),
    sessionId: SESSION,
    conversationId: cause.conversationId,
    seq: 1,
    author: SYSTEM_AUTHOR,
    mentions: [],
    source: { kind: "system" },
    content: "stopped",
    cause,
    createdAt: new Date().toISOString(),
  };
}

function completion(authorId: string): MessageFacts {
  return {
    conversationId: "home",
    seq: 1,
    authorId,
    sourceKind: "agent",
    mentions: [],
    endsRun: true,
  };
}

/** A harness of real in-memory engines. A live wave is set only through fan-out
 * delivery (which needs a socket server), so waves are supplied as a stub. */
function harness(waves: WaveReader = { listWaves: () => [] }) {
  const store = new InMemorySessionStore();
  const membershipStore = new InMemoryMembershipStore();
  const memberships = new MembershipRegistry(
    store,
    membershipStore,
    () => true,
  );
  const reactors = new ReactorRegistry(new InMemoryReactorStore());
  const runs = new RunRegistry(new InMemoryRunStore());
  const admission = new AdmissionEngine(runs, () => ({ cancelled: true }));
  const correlations = new CorrelationEngine(runs);
  const catalog = new ResourceCatalog(new InMemoryResourceStore());
  const context = new ContextEngine(catalog);

  const deps: WorkflowViewDeps = {
    store,
    memberships,
    membershipStore,
    reactors,
    runs,
    admission,
    waves,
    correlations,
    context,
  };
  return {
    deps,
    store,
    membershipStore,
    reactors,
    runs,
    admission,
    correlations,
    catalog,
  };
}

/** Seeds one of every workflow fact into `home`: a fan-in one short of ready, an
 * open Run with a wake held behind it, an outstanding correlation, a digest, and
 * a cause in the log. */
async function seedStalled(h: ReturnType<typeof harness>): Promise<void> {
  await h.membershipStore.put(membership({ transcriptVisibility: "shared" }));

  await h.reactors.install({
    sessionId: SESSION,
    participantId: "prime",
    spec: { name: "awaitAll", participants: ["w1", "w2", "w3"] },
    scope: {
      memberships: [{ conversationId: "home", participantId: "prime" }],
      homeConversationId: "home",
    },
  });
  await h.reactors.observe(SESSION, "home", completion("w1"));
  await h.reactors.observe(SESSION, "home", completion("w2"));

  h.runs.open({
    sessionId: SESSION,
    participantId: "worker",
    homeConversationId: "home",
    ingress: "reaction",
  });
  const decision = h.admission.admit({
    sessionId: SESSION,
    participantId: "worker",
    conversationId: "home",
    policy: "coalesce",
    waveDepth: 0,
    deliver: () => {},
  });
  assert.equal(decision.action, "held");

  h.correlations.open({
    id: "c1",
    sessionId: SESSION,
    conversationId: "home",
    askedBy: "prime",
    askedOf: "worker",
  });

  await h.catalog.catalogIn("home", {
    sessionId: SESSION,
    kind: "memory",
    name: "Digest of seq 1\u20132",
    uri: "memory://digest/home/1-2",
    authorParticipantId: "digest",
    meta: { conversationId: "home", fromSeq: 1, toSeq: 2, count: 2 },
  });
  await h.store.appendMessage(
    causeMessage({
      kind: "run-error",
      participantId: "worker",
      conversationId: "home",
      runId: "r1",
      waveDepth: 0,
    }),
  );
}

test("the workflow view resolves a stalled conversation to checkable facts", async () => {
  const h = harness({
    listWaves: () => [{ participantId: "prime", depth: 3 }],
  });
  await seedStalled(h);

  const view = await workflowView(h.deps, { sessionId: SESSION });

  assert.equal(view.memberships.length, 1);
  assert.equal(view.memberships[0].policy.visibility, "shared");

  assert.equal(view.reactors.length, 1);
  assert.equal(view.reactors[0].ready, false);
  const state = view.reactors[0].state;
  assert.deepEqual(state.kind === "await" ? state.seen : [], ["w1", "w2"]);

  assert.equal(view.runs.length, 1);
  assert.equal(view.runs[0].participantId, "worker");
  assert.equal(view.runs[0].admissionQueueDepth, 1);

  assert.equal(view.waves.length, 1);
  assert.equal(view.waves[0].depth, 3);
  assert.equal(view.waves[0].budget, MAX_WAVE_DEPTH);

  assert.equal(view.correlations.length, 1);
  assert.equal(view.correlations[0].askedBy, "prime");

  assert.equal(view.causes.length, 1);
  assert.equal(view.causes[0].kind, "run-error");

  assert.equal(view.digests.length, 1);
  assert.equal(view.digests[0].uri, "memory://digest/home/1-2");
});

test("naming a conversation scopes reactors, runs and correlations to it", async () => {
  const h = harness();
  await h.membershipStore.put(membership({ conversationId: "A" }));

  await h.reactors.install({
    sessionId: SESSION,
    participantId: "prime",
    spec: { name: "firstOf", participants: ["w1"] },
    scope: {
      memberships: [{ conversationId: "B", participantId: "prime" }],
      homeConversationId: "B",
    },
  });
  h.runs.open({
    sessionId: SESSION,
    participantId: "prime",
    homeConversationId: "B",
    ingress: "reaction",
  });
  h.correlations.open({
    id: "cB",
    sessionId: SESSION,
    conversationId: "B",
    askedBy: "prime",
  });

  const inA = await workflowView(h.deps, {
    sessionId: SESSION,
    conversationId: "A",
  });
  assert.equal(inA.reactors.length, 0, "reactor watches B, not A");
  assert.equal(inA.runs.length, 0, "run's home is B, not A");
  assert.equal(inA.correlations.length, 0, "correlation is in B, not A");

  const inB = await workflowView(h.deps, {
    sessionId: SESSION,
    conversationId: "B",
  });
  assert.equal(inB.reactors.length, 1);
  assert.equal(inB.runs.length, 1);
  assert.equal(inB.correlations.length, 1);
});

test("room is omitted unless both ids are named, and never leaks to a non-member", async () => {
  const h = harness();
  await h.store.appendMessage({
    id: randomUUID(),
    sessionId: SESSION,
    conversationId: "home",
    seq: 1,
    author: { id: "w1", kind: "agent", name: "Worker" },
    mentions: [],
    source: { kind: "agent" },
    content: "secret worker chatter",
    endsRun: true,
    createdAt: new Date().toISOString(),
  });

  const withoutParticipant = await workflowView(h.deps, {
    sessionId: SESSION,
    conversationId: "home",
  });
  assert.equal(withoutParticipant.room, undefined);

  // "stranger" holds no Membership in `home`, so it defaults to opaque: only
  // what addressed it, which is nothing here.
  const asStranger = await workflowView(h.deps, {
    sessionId: SESSION,
    conversationId: "home",
    participantId: "stranger",
  });
  assert.ok(asStranger.room);
  assert.equal(
    asStranger.room?.messages.length,
    0,
    "opaque non-member sees nothing",
  );
});
