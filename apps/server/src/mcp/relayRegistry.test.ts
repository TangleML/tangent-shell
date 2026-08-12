import assert from "node:assert/strict";
import { test } from "node:test";

import { dispatchMcp } from "./mcpRelayServer.ts";
import { RelayRegistry } from "./relayRegistry.ts";

/** A report that records what it was handed instead of entering a session. */
function captureReport() {
  const reported: Array<{ channelId: string; text: string }> = [];
  return {
    reported,
    report: async (channel: { channelId: string }, text: string) => {
      reported.push({ channelId: channel.channelId, text });
    },
  };
}

test("open issues a distinct channel id and secret bound to the session", () => {
  const registry = new RelayRegistry();
  const a = registry.open({ sessionId: "s1", label: "explorer" });
  const b = registry.open({ sessionId: "s1" });

  assert.notEqual(a.channelId, b.channelId);
  assert.notEqual(a.secret, b.secret);
  assert.equal(registry.get(a.channelId)?.sessionId, "s1");
  assert.equal(registry.get(a.channelId)?.label, "explorer");
  assert.equal(registry.get(b.channelId)?.label, "remote agent");
});

test("a channel opened for a participant records whose it is", () => {
  const registry = new RelayRegistry();
  const owned = registry.open({ sessionId: "s1", participantId: "ext-1" });
  const unowned = registry.open({ sessionId: "s1" });

  assert.equal(registry.get(owned.channelId)?.participantId, "ext-1");
  assert.equal(registry.get(unowned.channelId)?.participantId, undefined);
});

test("a channel's credential opens that channel and no other", () => {
  const registry = new RelayRegistry();
  const a = registry.open({ sessionId: "s1" });
  const b = registry.open({ sessionId: "s1" });

  const credential = registry.get(a.channelId)!.credential;
  assert.equal(
    credential.verify({ authorization: `Bearer ${a.secret}` }),
    true,
  );
  assert.equal(
    credential.verify({ authorization: `Bearer ${b.secret}` }),
    false,
  );
});

test("answer resolves a pending question and takeAnswer consumes it once", () => {
  const registry = new RelayRegistry();
  const { channelId } = registry.open({ sessionId: "s1" });
  registry.addQuestion(channelId, "r1", "which zone?");

  assert.deepEqual(registry.pending(channelId), [
    { request_id: "r1", question: "which zone?" },
  ]);

  assert.equal(registry.answer(channelId, "r1", "zone-42"), true);
  assert.equal(registry.takeAnswer(channelId, "r1"), "zone-42");
  assert.equal(registry.takeAnswer(channelId, "r1"), undefined);
  assert.deepEqual(registry.pending(channelId), []);
});

test("close removes the channel", () => {
  const registry = new RelayRegistry();
  const { channelId } = registry.open({ sessionId: "s1" });
  assert.equal(registry.close(channelId), true);
  assert.equal(registry.get(channelId), undefined);
  assert.equal(registry.close(channelId), false);
});

test("tools/list advertises the two relay tools", async () => {
  const registry = new RelayRegistry();
  const channel = registry.get(registry.open({ sessionId: "s1" }).channelId)!;
  const res = await dispatchMcp(
    registry,
    channel,
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    captureReport().report,
  );

  const tools = (res?.result as { tools: { name: string }[] }).tools;
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "ask_prime",
    "send_to_prime",
  ]);
});

test("send_to_prime reports the peer's own words, unwrapped", async () => {
  const registry = new RelayRegistry();
  const channel = registry.get(
    registry.open({ sessionId: "s1", label: "explorer" }).channelId,
  )!;
  const capture = captureReport();

  const res = await dispatchMcp(
    registry,
    channel,
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "send_to_prime", arguments: { text: "found it" } },
    },
    capture.report,
  );

  // Framing belongs to whoever lands the text, so what arrives here is exactly
  // what the peer said — a bound channel posts it as the participant's own words.
  assert.deepEqual(capture.reported, [
    { channelId: channel.channelId, text: "found it" },
  ]);
  const content = (res?.result as { content: { text: string }[] }).content;
  assert.match(content[0].text, /Delivered/);
});

test("ask_prime reports the question with the id an answer must name", async () => {
  const registry = new RelayRegistry();
  const { channelId } = registry.open({ sessionId: "s1" });
  const channel = registry.get(channelId)!;
  const capture = captureReport();

  const call = dispatchMcp(
    registry,
    channel,
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "ask_prime", arguments: { question: "which zone?" } },
    },
    capture.report,
  );

  // The pending question is registered before the report is awaited, so the
  // request id is answerable by the time anyone reads it.
  const [pending] = registry.pending(channelId);
  assert.equal(pending.question, "which zone?");
  assert.match(capture.reported[0].text, /which zone\?/);
  assert.match(capture.reported[0].text, new RegExp(pending.request_id));

  registry.answer(channelId, pending.request_id, "zone-42");
  const res = await call;
  const content = (res?.result as { content: { text: string }[] }).content;
  assert.equal(content[0].text, "zone-42");
});

test("notifications receive no response body", async () => {
  const registry = new RelayRegistry();
  const channel = registry.get(registry.open({ sessionId: "s1" }).channelId)!;
  const res = await dispatchMcp(
    registry,
    channel,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    captureReport().report,
  );
  assert.equal(res, null);
});
