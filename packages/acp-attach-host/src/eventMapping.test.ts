import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionNotification } from "@agentclientprotocol/sdk";

import { TurnStreamer } from "./eventMapping.ts";

type Update = SessionNotification["update"];

function toolCall(toolCallId: string, title: string, status?: string): Update {
  return {
    sessionUpdate: "tool_call",
    toolCallId,
    title,
    ...(status ? { status } : {}),
  } as Update;
}

function toolUpdate(
  toolCallId: string,
  status: string,
  title?: string,
): Update {
  return {
    sessionUpdate: "tool_call_update",
    toolCallId,
    status,
    ...(title ? { title } : {}),
  } as Update;
}

function messageChunk(text: string): Update {
  return {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  } as Update;
}

test("a completed tool stops spinning before the turn ends", () => {
  const streamer = new TurnStreamer();

  assert.deepEqual(
    streamer.apply(toolCall("t1", "Running grep", "in_progress")),
    [{ type: "activity", activity: { kind: "tool", label: "Running grep" } }],
  );

  assert.deepEqual(streamer.apply(toolUpdate("t1", "completed")), [
    { type: "activity", activity: null },
  ]);

  assert.deepEqual(streamer.end(), []);
});

test("a tool still running when the turn ends is cleared", () => {
  const streamer = new TurnStreamer();

  streamer.apply(toolCall("t1", "Running grep", "in_progress"));

  assert.deepEqual(streamer.end(), [{ type: "activity", activity: null }]);
});

test("a remaining tool keeps the indicator after an earlier one finishes", () => {
  const streamer = new TurnStreamer();

  streamer.apply(toolCall("t1", "Running grep", "in_progress"));
  assert.deepEqual(
    streamer.apply(toolCall("t2", "Reading file", "in_progress")),
    [{ type: "activity", activity: { kind: "tool", label: "Reading file" } }],
  );

  assert.deepEqual(streamer.apply(toolUpdate("t2", "completed")), [
    { type: "activity", activity: { kind: "tool", label: "Running grep" } },
  ]);

  assert.deepEqual(streamer.apply(toolUpdate("t1", "completed")), [
    { type: "activity", activity: null },
  ]);
});

test("assistant text clears a prior tool indicator and opens the bubble", () => {
  const streamer = new TurnStreamer();

  streamer.apply(toolCall("t1", "Running grep", "in_progress"));

  assert.deepEqual(streamer.apply(messageChunk("Hel")), [
    { type: "start", messageId: streamer.messageId },
    { type: "activity", activity: null },
    { type: "delta", messageId: streamer.messageId, delta: "Hel" },
  ]);

  streamer.apply(messageChunk("lo"));

  assert.deepEqual(streamer.end(), [
    {
      type: "end",
      messageId: streamer.messageId,
      content: "Hello",
      thinking: "",
    },
  ]);
});
