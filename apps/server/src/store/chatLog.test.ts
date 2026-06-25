import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { ChatMessage } from "@tangent/shared/contracts.ts";

import { appendMessage, readActivity } from "./chatLog.ts";

function tempRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "chatlog-"));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function agentMessage(id: string, createdAt: string): ChatMessage {
  return {
    id,
    sessionId: "s",
    conversationId: "prime",
    author: { id: "prime", kind: "agent", name: "Prime" },
    content: "hi",
    createdAt,
  };
}

function humanMessage(id: string, createdAt: string): ChatMessage {
  return {
    id,
    sessionId: "s",
    conversationId: "prime",
    author: { id: "u", kind: "human", name: "You" },
    content: "hi",
    createdAt,
  };
}

function subagentMessage(id: string, createdAt: string): ChatMessage {
  return {
    id,
    sessionId: "s",
    conversationId: "sub-1",
    author: {
      id: "sub-1",
      kind: "agent",
      name: "Worker",
      agentRole: "subagent",
    },
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
    await appendMessage(root, humanMessage("1", "2026-01-01T00:00:00.000Z"));
    await appendMessage(root, agentMessage("2", "2026-01-01T00:00:01.000Z"));
    await appendMessage(root, agentMessage("3", "2026-01-01T00:00:02.000Z"));

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
    await appendMessage(root, agentMessage("1", "2026-01-01T00:00:00.000Z"));
    await appendMessage(root, subagentMessage("2", "2026-01-01T00:00:01.000Z"));
    await appendMessage(root, subagentMessage("3", "2026-01-01T00:00:02.000Z"));

    const all = await readActivity(root);
    assert.equal(all.unreadCount, 1, "subagent messages are excluded");
  } finally {
    cleanup();
  }
});

test("readActivity only counts agent messages strictly after `since`", async () => {
  const { root, cleanup } = tempRoot();
  try {
    await appendMessage(root, agentMessage("1", "2026-01-01T00:00:00.000Z"));
    await appendMessage(root, agentMessage("2", "2026-01-01T00:00:01.000Z"));
    await appendMessage(root, humanMessage("3", "2026-01-01T00:00:02.000Z"));

    const since = await readActivity(root, "2026-01-01T00:00:00.000Z");
    assert.equal(since.unreadCount, 1, "the at-or-before message is excluded");
    assert.equal(since.lastActivityAt, "2026-01-01T00:00:02.000Z");
  } finally {
    cleanup();
  }
});
