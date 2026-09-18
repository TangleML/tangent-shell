import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ChatAuthor,
  ChatMessage,
  TranscriptVisibility,
} from "@tangent/shared/contracts.ts";

import { InMemoryResourceStore } from "../store/inMemoryResourceStore.ts";
import {
  ContextEngine,
  type ContextPolicy,
  DIGEST_AUTHOR_ID,
  policyFor,
  projectRoom,
} from "./context.ts";
import { ResourceCatalog } from "./resourceCatalog.ts";

const HUMAN: ChatAuthor = { id: "u", kind: "human", name: "User" };
const PRIME: ChatAuthor = { id: "prime", kind: "agent", name: "Prime" };

/** A Message with sane defaults, so a test states only what it varies. */
function msg(seq: number, extra: Partial<ChatMessage> = {}): ChatMessage {
  const author = extra.author ?? HUMAN;
  const source =
    author.kind === "human"
      ? { kind: "human" as const }
      : { kind: "agent" as const };
  return {
    id: `m${seq}`,
    sessionId: "s1",
    conversationId: "c1",
    seq,
    author,
    mentions: [],
    source,
    content: "x",
    createdAt: new Date(seq * 1000).toISOString(),
    ...extra,
  };
}

/** An engine over a throwaway in-memory catalog. */
function engine(): { engine: ContextEngine; catalog: ResourceCatalog } {
  const catalog = new ResourceCatalog(new InMemoryResourceStore());
  return { engine: new ContextEngine(catalog), catalog };
}

/** A summarized policy with an explicit budget, so a test controls the band. */
function budgeted(
  maxChars: number,
  summarizer = DIGEST_AUTHOR_ID,
): ContextPolicy {
  return {
    budget: { maxChars },
    classify: () => "verbatim",
    summarizer,
    pinned: [],
  };
}

test("shared reads the whole log verbatim, with no digest", async () => {
  const { engine: ctx } = engine();
  const messages = [msg(1), msg(2), msg(3)];

  const projection = await ctx.project({
    sessionId: "s1",
    conversationId: "c1",
    participantId: "prime",
    messages,
    policy: policyFor("shared"),
  });

  assert.deepEqual(
    projection.messages.map((m) => m.seq),
    [1, 2, 3],
  );
  assert.equal(projection.digests.length, 0);
  assert.equal(projection.omitted.length, 0);
});

test("opaque keeps only what addresses the participant, omitting the rest", async () => {
  const { engine: ctx } = engine();
  const messages = [
    msg(1, { content: "unaddressed human turn" }),
    msg(2, { mentions: ["prime"], content: "hey prime" }),
    msg(3, { author: PRIME, content: "prime's own turn" }),
    msg(4, { author: HUMAN, content: "another aside" }),
  ];

  const projection = await ctx.project({
    sessionId: "s1",
    conversationId: "c1",
    participantId: "prime",
    messages,
    policy: policyFor("opaque"),
  });

  assert.deepEqual(
    projection.messages.map((m) => m.seq),
    [2, 3],
    "only the addressing and self-authored Messages survive",
  );
  assert.equal(projection.digests.length, 0);
  assert.deepEqual(projection.omitted, [
    { fromSeq: 1, toSeq: 1 },
    { fromSeq: 4, toSeq: 4 },
  ]);
});

test("summarized spends the budget newest-first and digests the older band", async () => {
  const { engine: ctx, catalog } = engine();
  const messages = [
    msg(1, { content: "0123456789" }),
    msg(2, { content: "0123456789" }),
    msg(3, { content: "0123456789" }),
    msg(4, { content: "0123456789" }),
  ];

  const projection = await ctx.project({
    sessionId: "s1",
    conversationId: "c1",
    participantId: "prime",
    messages,
    policy: budgeted(15),
  });

  assert.deepEqual(
    projection.messages.map((m) => m.seq),
    [4],
    "only the newest Message fits a 15-char budget",
  );
  assert.equal(projection.digests.length, 1);
  const digest = projection.digests[0];
  assert.equal(digest.kind, "memory");
  assert.equal(digest.authorParticipantId, DIGEST_AUTHOR_ID);
  assert.equal(digest.meta?.fromSeq, 1);
  assert.equal(digest.meta?.toSeq, 3);

  const referenced = await catalog.listForConversation("s1", "c1");
  assert.equal(referenced.length, 1, "the digest is referenced in the thread");
});

test("a late join reads digest(0..N) plus everything verbatim after N", async () => {
  const { engine: ctx } = engine();
  const messages = Array.from({ length: 6 }, (_, i) =>
    msg(i + 1, { content: "0123456789" }),
  );

  const projection = await ctx.project({
    sessionId: "s1",
    conversationId: "c1",
    participantId: "late",
    messages,
    policy: budgeted(25),
  });

  assert.deepEqual(
    projection.messages.map((m) => m.seq),
    [5, 6],
    "the two newest fit a 25-char budget",
  );
  assert.equal(projection.digests.length, 1);
  assert.equal(projection.digests[0].meta?.fromSeq, 1);
  assert.equal(projection.digests[0].meta?.toSeq, 4);
});

test("a digest of a range is cached: the same range yields the same Resource id", async () => {
  const { engine: ctx } = engine();
  const messages = [
    msg(1, { content: "0123456789" }),
    msg(2, { content: "0123456789" }),
    msg(3, { content: "0123456789" }),
  ];
  const input = {
    sessionId: "s1",
    conversationId: "c1",
    messages,
    policy: budgeted(5),
  };

  const first = await ctx.project({ ...input, participantId: "ana" });
  const second = await ctx.project({ ...input, participantId: "ben" });

  assert.equal(first.digests.length, 1);
  assert.equal(second.digests.length, 1);
  assert.equal(
    first.digests[0].id,
    second.digests[0].id,
    "one digest of a range serves every Membership that asks for it",
  );
});

test("a connector summarizer produces no Tangent digest and no catalog write", async () => {
  const { engine: ctx, catalog } = engine();
  const messages = [
    msg(1, { content: "0123456789" }),
    msg(2, { content: "0123456789" }),
  ];

  const projection = await ctx.project({
    sessionId: "s1",
    conversationId: "c1",
    participantId: "peer",
    messages,
    policy: budgeted(5, "connector"),
  });

  assert.equal(projection.digests.length, 0);
  assert.equal(projection.omitted.length, 0, "the far end owns the older band");
  const all = await catalog.listForSession("s1");
  assert.equal(all.length, 0, "nothing was catalogued");
});

test("a none summarizer omits the older band rather than digesting it", async () => {
  const { engine: ctx, catalog } = engine();
  const messages = [
    msg(1, { content: "0123456789" }),
    msg(2, { content: "0123456789" }),
    msg(3, { content: "0123456789" }),
  ];

  const projection = await ctx.project({
    sessionId: "s1",
    conversationId: "c1",
    participantId: "p",
    messages,
    policy: budgeted(15, "none"),
  });

  assert.deepEqual(
    projection.messages.map((m) => m.seq),
    [3],
  );
  assert.equal(projection.digests.length, 0);
  assert.deepEqual(projection.omitted, [{ fromSeq: 1, toSeq: 2 }]);
  assert.equal((await catalog.listForSession("s1")).length, 0);
});

test("coverage lists the digest Resources of one Conversation", async () => {
  const { engine: ctx } = engine();
  const messages = [
    msg(1, { content: "0123456789" }),
    msg(2, { content: "0123456789" }),
    msg(3, { content: "0123456789" }),
  ];
  await ctx.project({
    sessionId: "s1",
    conversationId: "c1",
    participantId: "p",
    messages,
    policy: budgeted(5),
  });

  const coverage = await ctx.coverage("s1", "c1");
  assert.equal(coverage.length, 1);
  assert.match(coverage[0].uri, /^memory:\/\/digest\/c1\//);
});

/** A store that answers one Conversation's messages, for projectRoom. */
function fakeStore(messages: ChatMessage[]) {
  return { getConversationMessages: async () => messages };
}

/** A membership lookup returning a fixed visibility (or none). */
function fakeMemberships(visibility: TranscriptVisibility | undefined) {
  return {
    memberIn: async () =>
      visibility ? { transcriptVisibility: visibility } : undefined,
  };
}

test("projectRoom applies the reader's opaque visibility, not leaking the log", async () => {
  const { engine: ctx } = engine();
  const messages = [
    msg(1, { content: "secret" }),
    msg(2, { mentions: ["prime"], content: "for prime" }),
  ];

  const result = await projectRoom(
    ctx,
    fakeStore(messages),
    fakeMemberships("opaque"),
    { sessionId: "s1", conversationId: "c1", participantId: "prime" },
  );

  assert.deepEqual(
    result.messages.map((m) => m.seq),
    [2],
  );
});

test("projectRoom defaults to opaque when the reader holds no Membership", async () => {
  const { engine: ctx } = engine();
  const messages = [msg(1, { content: "secret" }), msg(2, { content: "more" })];

  const result = await projectRoom(
    ctx,
    fakeStore(messages),
    fakeMemberships(undefined),
    { sessionId: "s1", conversationId: "c1", participantId: "stranger" },
  );

  assert.equal(
    result.messages.length,
    0,
    "a non-member sees only what named it",
  );
});

test("projectRoom clamps the verbatim tail to limit without dropping digests", async () => {
  const { engine: ctx } = engine();
  const messages = [msg(1), msg(2), msg(3), msg(4)];

  const result = await projectRoom(
    ctx,
    fakeStore(messages),
    fakeMemberships("shared"),
    { sessionId: "s1", conversationId: "c1", participantId: "prime", limit: 2 },
  );

  assert.deepEqual(
    result.messages.map((m) => m.seq),
    [3, 4],
  );
});
