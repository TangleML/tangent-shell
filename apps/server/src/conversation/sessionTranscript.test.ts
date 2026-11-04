import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type {
  ChatMessage,
  Session,
  UserIdentity,
} from "@tangent/shared/contracts.ts";

import type { SessionAgent } from "../store/sessionStore.ts";
import {
  canReadTranscript,
  formatTranscript,
  primeMessages,
  readSessionSummary,
  resolveTarget,
  scopedSessions,
  searchTranscripts,
  TRANSCRIPT_REFUSAL,
} from "./sessionTranscript.ts";

const ALICE: UserIdentity = {
  email: "alice@example.com",
  first_name: "Alice",
  last_name: "A",
};
const BOB: UserIdentity = {
  email: "bob@example.com",
  first_name: "Bob",
  last_name: "B",
};

function session(overrides: Partial<Session>): Session {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    name: "Session",
    rootPath: "/nonexistent",
    status: "created",
    archived: false,
    accessPolicy: "open",
    tags: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function message(
  seq: number,
  content: string,
  human = false,
  createdAt = "2026-11-01T00:00:00.000Z",
): ChatMessage {
  return {
    id: `m${seq}`,
    sessionId: "s",
    conversationId: "c",
    seq,
    author: human
      ? { id: "alice@example.com", kind: "human", name: "Alice" }
      : { id: "prime", kind: "agent", name: "Prime", agentRole: "prime" },
    mentions: [],
    source: { kind: human ? "human" : "agent" },
    content,
    thinking: "private reasoning",
    createdAt,
  };
}

const storyA = session({
  id: "3f2a91c0-1111-4111-8111-111111111111",
  name: "Bedtime story",
  tags: ["projectId:A"],
  updatedAt: "2026-11-02T00:00:00.000Z",
});
const otherA = session({
  id: "3f2a91c0-2222-4222-8222-222222222222",
  name: "Another A",
  tags: ["projectId:A", "team:X"],
  updatedAt: "2026-11-03T00:00:00.000Z",
});
const currentA = session({
  id: "aaaaaaaa-0000-4000-8000-000000000000",
  tags: ["projectId:A"],
});
const currentB = session({
  id: "bbbbbbbb-0000-4000-8000-000000000000",
  tags: ["projectId:B"],
});
const untagged = session({ id: "cccccccc-0000-4000-8000-000000000000" });
const all = [storyA, otherA, currentA, currentB, untagged];

test("a session reads a sibling that carries its selector", () => {
  assert.equal(canReadTranscript(currentA, storyA), true);
  const resolved = resolveTarget(all, currentA, storyA.id);
  assert.deepEqual(resolved, { session: storyA });
});

test("a session with a different selector is refused deterministically", () => {
  assert.equal(canReadTranscript(currentB, storyA), false);
  assert.deepEqual(resolveTarget(all, currentB, storyA.id), {
    refused: TRANSCRIPT_REFUSAL,
  });
  assert.deepEqual(
    scopedSessions(all, currentB).map((s) => s.id),
    [currentB.id],
  );
});

test("an untagged session reads, lists, and searches nothing", () => {
  assert.equal(canReadTranscript(untagged, storyA), false);
  assert.equal(canReadTranscript(untagged, untagged), false);
  assert.deepEqual(scopedSessions(all, untagged), []);
  assert.deepEqual(resolveTarget(all, untagged, storyA.id), {
    refused: TRANSCRIPT_REFUSAL,
  });
});

test("the target must carry every selector of the current session", () => {
  const currentAX = session({ tags: ["projectId:A", "team:X"] });
  assert.equal(canReadTranscript(currentA, otherA), true);
  assert.equal(canReadTranscript(currentAX, otherA), true);
  assert.equal(canReadTranscript(currentAX, storyA), false);
});

test("a restricted target is readable only by a session with the same owner", () => {
  const restricted = session({
    tags: ["projectId:A"],
    accessPolicy: "restricted",
    user: ALICE,
  });
  const byAlice = session({ tags: ["projectId:A"], user: ALICE });
  const byBob = session({ tags: ["projectId:A"], user: BOB });
  const anonymous = session({ tags: ["projectId:A"] });
  assert.equal(canReadTranscript(byAlice, restricted), true);
  assert.equal(canReadTranscript(byBob, restricted), false);
  assert.equal(canReadTranscript(anonymous, restricted), false);
  assert.equal(
    canReadTranscript(byBob, { ...restricted, accessPolicy: "open" }),
    true,
  );
});

test("a prefix or memory stamp resolves when unique among in-scope sessions", () => {
  const unique = resolveTarget(all, currentA, "aaaaaaaa");
  assert.deepEqual(unique, { session: currentA });
  assert.deepEqual(resolveTarget(all, currentA, "[aaaaaaaa]"), {
    session: currentA,
  });
  assert.ok("ambiguous" in resolveTarget(all, currentA, "3f2a91c0"));
  assert.deepEqual(resolveTarget(all, currentA, "3f2a91c0-1111"), {
    session: storyA,
  });
  assert.ok("refused" in resolveTarget(all, currentA, "3f2a"));
});

test("an out-of-scope prefix is refused rather than ambiguous", () => {
  const currentAX = session({ tags: ["projectId:A", "team:X"] });
  assert.deepEqual(resolveTarget(all, currentAX, "3f2a91c0"), {
    session: otherA,
  });
  assert.deepEqual(resolveTarget(all, currentB, "3f2a91c0"), {
    refused: TRANSCRIPT_REFUSAL,
  });
});

test("search matches every term, most recently used session first", () => {
  const entries = [
    {
      session: storyA,
      messages: [
        message(1, "Tell me a bedtime story", true),
        message(2, "Once upon a time a dragon named Ember slept in a cave."),
      ],
    },
    {
      session: otherA,
      messages: [
        message(
          1,
          "The dragon Ember returns in a sequel.",
          false,
          "2026-11-05T00:00:00.000Z",
        ),
      ],
    },
  ];
  const hits = searchTranscripts(entries, "Dragon ember");
  assert.deepEqual(
    hits.map((hit) => [hit.sessionId, hit.seq]),
    [
      [otherA.id, 1],
      [storyA.id, 2],
    ],
  );
  assert.equal(hits[1].author, "Prime (agent)");
  assert.match(hits[1].snippet, /dragon named Ember/);
  assert.equal(searchTranscripts(entries, "dragon", 1).length, 1);
  assert.deepEqual(searchTranscripts(entries, "unicorn"), []);
  assert.deepEqual(searchTranscripts(entries, "   "), []);
});

test("a long match is snippeted around the first term", () => {
  const long = `${"a ".repeat(400)}needle ${"b ".repeat(400)}`;
  const [hit] = searchTranscripts(
    [{ session: storyA, messages: [message(1, long)] }],
    "needle",
  );
  assert.ok(hit.snippet.startsWith("…"));
  assert.ok(hit.snippet.endsWith("…"));
  assert.match(hit.snippet, /needle/);
  assert.ok(hit.snippet.length < 320);
});

test("transcripts page from a seq and never include reasoning", () => {
  const messages = [1, 2, 3, 4, 5].map((seq) =>
    message(seq, `line ${seq}`, seq % 2 === 1),
  );
  const first = formatTranscript(messages, { limit: 2 });
  assert.equal(first.shown, 2);
  assert.equal(first.total, 5);
  assert.equal(first.nextFromSeq, 3);
  assert.match(first.text, /^#1 Alice \(human\): line 1/);
  assert.doesNotMatch(first.text, /private reasoning/);

  const last = formatTranscript(messages, { fromSeq: 4 });
  assert.equal(last.shown, 2);
  assert.equal(last.nextFromSeq, undefined);
  assert.match(last.text, /#5 Alice \(human\): line 5$/);
});

test("a page stops at the character cap but always holds one message", () => {
  const huge = "x".repeat(30_000);
  const page = formatTranscript([message(1, huge), message(2, huge)]);
  assert.equal(page.shown, 1);
  assert.equal(page.nextFromSeq, 2);
});

test("the session summary is read from MEMORY.md, empty when missing", () => {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-transcript-"));
  try {
    assert.equal(readSessionSummary(session({ rootPath: root })), "");
    writeFileSync(path.join(root, "MEMORY.md"), "  Told a dragon story.\n");
    assert.equal(
      readSessionSummary(session({ rootPath: root })),
      "Told a dragon story.",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a long MEMORY.md keeps its newest tail, not the seeded head", () => {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-transcript-"));
  try {
    const seed = `${"seeded boilerplate ".repeat(200)}\n`;
    writeFileSync(
      path.join(root, "MEMORY.md"),
      `${seed}Prime's note: the codename is BLUEBIRD.`,
    );
    const summary = readSessionSummary(session({ rootPath: root }));
    assert.ok(summary.startsWith("…"));
    assert.ok(summary.length <= 2_001);
    assert.match(summary, /codename is BLUEBIRD/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("search orders by last message time, not updatedAt", () => {
  const recentlyUsed = session({
    id: "11111111-0000-4000-8000-000000000000",
    tags: ["projectId:A"],
    updatedAt: "2026-11-01T00:00:00.000Z",
  });
  const staleButRenamed = session({
    id: "22222222-0000-4000-8000-000000000000",
    tags: ["projectId:A"],
    updatedAt: "2026-11-09T00:00:00.000Z",
  });
  const hits = searchTranscripts(
    [
      {
        session: staleButRenamed,
        messages: [message(1, "dragon", false, "2026-11-02T00:00:00.000Z")],
      },
      {
        session: recentlyUsed,
        messages: [message(1, "dragon", false, "2026-11-08T00:00:00.000Z")],
      },
    ],
    "dragon",
  );
  assert.deepEqual(
    hits.map((hit) => hit.sessionId),
    [recentlyUsed.id, staleButRenamed.id],
  );
});

test("primeMessages reads Prime's home conversation, empty without Prime", async () => {
  const conversations: string[] = [];
  const store = {
    listAgents: async (sessionId: string) =>
      sessionId === "with-prime"
        ? [{ id: "prime", homeConversationId: "home-1" } as SessionAgent]
        : [],
    getConversationMessages: async (_sessionId: string, id: string) => {
      conversations.push(id);
      return [message(1, "hi")];
    },
  };
  assert.equal((await primeMessages(store, "with-prime")).length, 1);
  assert.deepEqual(conversations, ["home-1"]);
  assert.deepEqual(await primeMessages(store, "no-prime"), []);
});
