import assert from "node:assert/strict";
import { test } from "node:test";

import { dispatchMcp } from "./mcpRelayServer.ts";
import { RelayRegistry } from "./relayRegistry.ts";

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
    () => {},
  );

  const tools = (res?.result as { tools: { name: string }[] }).tools;
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "ask_prime",
    "send_to_prime",
  ]);
});

test("send_to_prime relays labeled text to the session's Prime", async () => {
  const registry = new RelayRegistry();
  const channel = registry.get(
    registry.open({ sessionId: "s1", label: "explorer" }).channelId,
  )!;
  const delivered: Array<{ sessionId: string; text: string }> = [];

  const res = await dispatchMcp(
    registry,
    channel,
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "send_to_prime", arguments: { text: "found it" } },
    },
    (sessionId, text) => delivered.push({ sessionId, text }),
  );

  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].sessionId, "s1");
  assert.match(delivered[0].text, /explorer/);
  assert.match(delivered[0].text, /found it/);
  const content = (res?.result as { content: { text: string }[] }).content;
  assert.match(content[0].text, /Delivered/);
});

test("notifications receive no response body", async () => {
  const registry = new RelayRegistry();
  const channel = registry.get(registry.open({ sessionId: "s1" }).channelId)!;
  const res = await dispatchMcp(
    registry,
    channel,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    () => {},
  );
  assert.equal(res, null);
});
