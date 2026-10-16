import assert from "node:assert/strict";
import { test } from "node:test";

import type { RemoteSpawnCommand } from "@tangent/shared/remoteSubagent.ts";

import { buildPiArgs } from "./piAdapter.ts";
import {
  createStreamState,
  parsePiLine,
  type PiStdoutEvent,
  translatePiEvent,
} from "./piEvents.ts";

const newId = () => "msg-1";

function run(events: PiStdoutEvent[]) {
  const state = createStreamState();
  return events.flatMap((event) => translatePiEvent(state, event, newId));
}

const assistant = (text: string) => ({
  role: "assistant",
  content: [{ type: "text", text }],
});

test("streams one assistant message as start, deltas, then end", () => {
  const out = run([
    { type: "agent_start" },
    { type: "message_start", message: { role: "assistant" } },
    {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
    },
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hel" },
    },
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "lo" },
    },
    { type: "message_end", message: assistant("Hello") },
    { type: "agent_end" },
  ]);

  assert.deepEqual(out, [
    { type: "activity", activity: { kind: "thinking", label: "Thinking..." } },
    { type: "start", messageId: "msg-1" },
    { type: "activity", activity: null },
    { type: "thinking", messageId: "msg-1", delta: "hmm" },
    { type: "delta", messageId: "msg-1", delta: "Hel" },
    { type: "delta", messageId: "msg-1", delta: "lo" },
    { type: "end", messageId: "msg-1", content: "Hello", thinking: "hmm" },
    { type: "activity", activity: { kind: "thinking", label: "Thinking..." } },
    { type: "activity", activity: null },
  ]);
});

test("a malformed content array does not crash the translation", () => {
  const out = run([
    { type: "message_start", message: { role: "assistant" } },
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hi" },
    },
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [null, { type: "text", text: "ok" }, { type: "image" }],
      } as unknown as PiStdoutEvent["message"],
    },
  ]);

  const end = out.find((event) => event.type === "end");
  assert.deepEqual(end, {
    type: "end",
    messageId: "msg-1",
    content: "ok",
    thinking: "",
  });
});

test("a non-object stdout line parses to null", () => {
  assert.equal(parsePiLine("[1,2,3]"), null);
  assert.equal(parsePiLine('"a string"'), null);
  assert.equal(parsePiLine("42"), null);
});

test("a tool-only assistant message opens no bubble", () => {
  const out = run([
    { type: "message_start", message: { role: "assistant" } },
    { type: "message_end", message: { role: "assistant", content: [] } },
  ]);

  assert.equal(
    out.some((event) => event.type === "start" || event.type === "end"),
    false,
  );
});

test("falls back to streamed text when the final message has none", () => {
  const out = run([
    { type: "message_start", message: { role: "assistant" } },
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "partial" },
    },
    { type: "message_end", message: { role: "assistant", content: [] } },
  ]);

  const end = out.find((event) => event.type === "end");
  assert.deepEqual(end, {
    type: "end",
    messageId: "msg-1",
    content: "partial",
    thinking: "",
  });
});

test("ignores user and tool-result messages", () => {
  const out = run([
    { type: "message_start", message: { role: "user" } },
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "x" },
    },
    { type: "message_end", message: { role: "user" } },
  ]);

  assert.deepEqual(out, []);
});

test("labels a running tool with its target", () => {
  const out = run([
    {
      type: "tool_execution_start",
      toolName: "bash",
      args: { command: "pnpm   test" },
    },
    { type: "tool_execution_start", toolName: "custom_tool", args: {} },
  ]);

  assert.deepEqual(out, [
    {
      type: "activity",
      activity: { kind: "tool", label: "Running pnpm test", toolName: "bash" },
    },
    {
      type: "activity",
      activity: {
        kind: "tool",
        label: "Running custom_tool",
        toolName: "custom_tool",
      },
    },
  ]);
});

test("relays queue updates, dropping non-string entries", () => {
  const out = run([
    { type: "queue_update", steering: ["steer", 3], followUp: "nope" },
  ]);

  assert.deepEqual(out, [{ type: "queue", steering: ["steer"], followUp: [] }]);
});

test("unknown event types and bad lines yield nothing", () => {
  assert.deepEqual(run([{ type: "turn_start" }, {}]), []);
  assert.equal(parsePiLine("not json"), null);
  assert.equal(parsePiLine("42"), null);
  assert.deepEqual(parsePiLine('{"type":"agent_end"}'), { type: "agent_end" });
});

const spawnCommand: RemoteSpawnCommand = {
  sessionId: "s1",
  agentId: "a1",
  name: "worker",
  tools: ["read", "bash", "message_prime", "read_room"],
  systemPrompt: "Be brief.",
  model: "openai/gpt-5",
  thinkingDepth: "low",
  autoRelayToPrime: true,
};

const launch = { bin: "pi", proxyExtensionPath: "/ext/proxyProvider.ts" };

test("pi args keep built-in tools, add read access, and pass the resolved config", () => {
  assert.deepEqual(buildPiArgs(spawnCommand, launch), [
    "--mode",
    "rpc",
    "--no-session",
    "--no-skills",
    "--model",
    "openai/gpt-5",
    "--thinking",
    "low",
    "--tools",
    "read,bash,grep,find,ls",
    "--append-system-prompt",
    "Be brief.",
  ]);
});

test("pi args honor a local model override, default tools, and the proxy", () => {
  const args = buildPiArgs(
    { ...spawnCommand, tools: ["message_prime"], thinkingDepth: undefined },
    { ...launch, model: "anthropic/claude", proxyUrl: "https://proxy" },
  );

  assert.deepEqual(args, [
    "--mode",
    "rpc",
    "--no-session",
    "--no-skills",
    "--model",
    "anthropic/claude",
    "--tools",
    "read,write,edit,bash,grep,find,ls",
    "--append-system-prompt",
    "Be brief.",
    "--extension",
    "/ext/proxyProvider.ts",
  ]);
});
