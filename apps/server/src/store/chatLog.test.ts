import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { ChatMessage } from "@tangent/shared/contracts.ts";

import {
  appendMessage,
  highestSeq,
  readActivity,
  readAllMessages,
  readMessages,
} from "./chatLog.ts";

function tempRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "chatlog-"));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Writes raw JSONL lines the way a pre-envelope build would have. */
function writeLegacyLog(
  root: string,
  conversationId: string,
  lines: Record<string, unknown>[],
): string {
  const dir = path.join(root, ".tangent", "chats");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${conversationId}.jsonl`);
  for (const line of lines) appendFileSync(file, `${JSON.stringify(line)}\n`);
  return file;
}

function agentMessage(id: string, createdAt: string, seq = 1): ChatMessage {
  return {
    id,
    sessionId: "s",
    conversationId: "prime",
    seq,
    author: { id: "prime", kind: "agent", name: "Prime" },
    mentions: [],
    source: { kind: "agent" },
    content: "hi",
    createdAt,
  };
}

function humanMessage(id: string, createdAt: string, seq = 1): ChatMessage {
  return {
    id,
    sessionId: "s",
    conversationId: "prime",
    seq,
    author: { id: "u", kind: "human", name: "You" },
    mentions: [],
    source: { kind: "human" },
    content: "hi",
    createdAt,
  };
}

function subagentMessage(id: string, createdAt: string, seq = 1): ChatMessage {
  return {
    id,
    sessionId: "s",
    conversationId: "sub-1",
    seq,
    author: {
      id: "sub-1",
      kind: "agent",
      name: "Worker",
      agentRole: "subagent",
    },
    mentions: [],
    source: { kind: "agent" },
    content: "hi",
    createdAt,
  };
}

test("readActivity returns zero for a session with no chat log", async () => {
  const { root, cleanup } = tempRoot();
  try {
    assert.deepEqual(await readActivity(root), {
      unreadCount: 0,
      lastActivityAt: undefined,
    });
  } finally {
    cleanup();
  }
});

test("readActivity counts only agent messages and tracks last activity", async () => {
  const { root, cleanup } = tempRoot();
  try {
    await appendMessage(root, humanMessage("1", "2026-01-01T00:00:00.000Z", 1));
    await appendMessage(root, agentMessage("2", "2026-01-01T00:00:01.000Z", 2));
    await appendMessage(root, agentMessage("3", "2026-01-01T00:00:02.000Z", 3));

    const all = await readActivity(root);
    assert.equal(all.unreadCount, 2);
    assert.equal(all.lastActivityAt, "2026-01-01T00:00:02.000Z");
  } finally {
    cleanup();
  }
});

test("readActivity counts only the Prime conversation, not subagents", async () => {
  const { root, cleanup } = tempRoot();
  try {
    await appendMessage(root, agentMessage("1", "2026-01-01T00:00:00.000Z", 1));
    await appendMessage(
      root,
      subagentMessage("2", "2026-01-01T00:00:01.000Z", 1),
    );
    await appendMessage(
      root,
      subagentMessage("3", "2026-01-01T00:00:02.000Z", 2),
    );

    const all = await readActivity(root);
    assert.equal(all.unreadCount, 1, "subagent messages are excluded");
  } finally {
    cleanup();
  }
});

test("readActivity only counts agent messages strictly after `since`", async () => {
  const { root, cleanup } = tempRoot();
  try {
    await appendMessage(root, agentMessage("1", "2026-01-01T00:00:00.000Z", 1));
    await appendMessage(root, agentMessage("2", "2026-01-01T00:00:01.000Z", 2));
    await appendMessage(root, humanMessage("3", "2026-01-01T00:00:02.000Z", 3));

    const since = await readActivity(root, "2026-01-01T00:00:00.000Z");
    assert.equal(since.unreadCount, 1, "the at-or-before message is excluded");
    assert.equal(since.lastActivityAt, "2026-01-01T00:00:02.000Z");
  } finally {
    cleanup();
  }
});

test("a line written before the envelope existed reads back with one", async () => {
  const { root, cleanup } = tempRoot();
  try {
    writeLegacyLog(root, "prime", [
      {
        id: "a",
        sessionId: "s",
        conversationId: "prime",
        author: { id: "u", kind: "human", name: "You" },
        content: "first",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "b",
        sessionId: "s",
        conversationId: "prime",
        author: { id: "prime", kind: "agent", name: "Prime" },
        content: "second",
        createdAt: "2026-01-01T00:00:01.000Z",
      },
      {
        id: "c",
        sessionId: "s",
        conversationId: "prime",
        author: { id: "system", kind: "agent", name: "System" },
        content: "third",
        createdAt: "2026-01-01T00:00:02.000Z",
      },
    ]);

    const messages = await readMessages(root, "prime");
    assert.deepEqual(
      messages.map((message) => message.seq),
      [1, 2, 3],
      "seq comes from the line's position in the log",
    );
    assert.deepEqual(
      messages.map((message) => message.source.kind),
      ["human", "agent", "system"],
      "provenance is derived from the author, System included",
    );
    assert.deepEqual(
      messages.map((message) => message.mentions),
      [[], [], []],
    );
    assert.deepEqual(
      messages.map((message) => message.cause),
      [undefined, undefined, undefined],
      "a line predating structured causes reads back with none",
    );
  } finally {
    cleanup();
  }
});

test("reading a legacy log never rewrites it", async () => {
  const { root, cleanup } = tempRoot();
  try {
    const file = writeLegacyLog(root, "prime", [
      {
        id: "a",
        sessionId: "s",
        conversationId: "prime",
        author: { id: "u", kind: "human", name: "You" },
        content: "first",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const before = readFileSync(file, "utf8");

    await readMessages(root, "prime");
    await readAllMessages(root);

    assert.equal(readFileSync(file, "utf8"), before);
  } finally {
    cleanup();
  }
});

test("a log that gained the envelope mid-file keeps one sequence", async () => {
  const { root, cleanup } = tempRoot();
  try {
    writeLegacyLog(root, "prime", [
      {
        id: "old-1",
        sessionId: "s",
        conversationId: "prime",
        author: { id: "u", kind: "human", name: "You" },
        content: "legacy",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "old-2",
        sessionId: "s",
        conversationId: "prime",
        author: { id: "prime", kind: "agent", name: "Prime" },
        content: "legacy",
        createdAt: "2026-01-01T00:00:01.000Z",
      },
    ]);
    assert.equal(await highestSeq(root, "prime"), 2);

    // What the store's counter would hand out next, seeded above the log.
    await appendMessage(
      root,
      humanMessage("new-1", "2026-01-01T00:00:02.000Z", 3),
    );

    const messages = await readMessages(root, "prime");
    assert.deepEqual(
      messages.map((message) => [message.id, message.seq]),
      [
        ["old-1", 1],
        ["old-2", 2],
        ["new-1", 3],
      ],
      "old positions and new allocations form one sequence",
    );
  } finally {
    cleanup();
  }
});

test("readMessages orders by seq, not by append order", async () => {
  const { root, cleanup } = tempRoot();
  try {
    // A steer persisted while an earlier turn was still streaming lands in the
    // file after the turn it interrupted but holds the lower seq.
    await appendMessage(
      root,
      agentMessage("late", "2026-01-01T00:00:09.000Z", 5),
    );
    await appendMessage(
      root,
      humanMessage("early", "2026-01-01T00:00:03.000Z", 4),
    );

    const messages = await readMessages(root, "prime");
    assert.deepEqual(
      messages.map((message) => message.id),
      ["early", "late"],
    );
  } finally {
    cleanup();
  }
});

test("readAllMessages still merges conversations by createdAt", async () => {
  const { root, cleanup } = tempRoot();
  try {
    // Each conversation numbers from 1, so seq says nothing across them.
    await appendMessage(
      root,
      subagentMessage("sub", "2026-01-01T00:00:00.000Z", 1),
    );
    await appendMessage(
      root,
      agentMessage("prime", "2026-01-01T00:00:01.000Z", 1),
    );

    const messages = await readAllMessages(root);
    assert.deepEqual(
      messages.map((message) => message.id),
      ["sub", "prime"],
    );
  } finally {
    cleanup();
  }
});
