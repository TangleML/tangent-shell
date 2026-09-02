import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatMessage } from "@tangent/shared/contracts.ts";

import {
  type CorrelationClock,
  CorrelationEngine,
} from "../conversation/correlation.ts";
import { RunRegistry } from "../runs/runRegistry.ts";
import { InMemoryRunStore } from "../store/inMemoryRunStore.ts";
import { dispatchMcp } from "./mcpRelayServer.ts";
import { RelayRegistry } from "./relayRegistry.ts";
import type { RelayEnvelope } from "./relayReport.ts";

/** A report that records what it was handed instead of entering a session. */
function captureReport() {
  const reported: Array<{
    channelId: string;
    text: string;
    envelope?: RelayEnvelope;
  }> = [];
  return {
    reported,
    report: async (
      channel: { channelId: string },
      text: string,
      envelope?: RelayEnvelope,
    ) => {
      reported.push({ channelId: channel.channelId, text, envelope });
    },
  };
}

/** A controllable clock: nothing fires until `advance` passes its instant. */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const scheduled = new Map<number, { at: number; fn: () => void }>();
  const clock: CorrelationClock = {
    now: () => now,
    schedule: (at, fn) => {
      const id = seq++;
      scheduled.set(id, { at, fn });
      return () => scheduled.delete(id);
    },
  };
  return {
    clock,
    advance(ms: number) {
      now += ms;
      for (const [id, s] of [...scheduled.entries()]) {
        if (s.at <= now) {
          scheduled.delete(id);
          s.fn();
        }
      }
    },
  };
}

function newCorrelations(clock: CorrelationClock): CorrelationEngine {
  return new CorrelationEngine(new RunRegistry(new InMemoryRunStore()), clock);
}

/** Yields so an awaited `report` inside a tool call has run. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function reply(inReplyTo: string, content: string): ChatMessage {
  return {
    id: "answer",
    sessionId: "s1",
    conversationId: "sub-1",
    seq: 2,
    author: { id: "prime", kind: "agent", name: "Prime" },
    mentions: [],
    source: { kind: "agent" },
    content,
    inReplyTo,
    createdAt: "2026-01-01T00:00:00.000Z",
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
  const { clock } = fakeClock();
  const res = await dispatchMcp(
    registry,
    channel,
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    captureReport().report,
    newCorrelations(clock),
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
  const { clock } = fakeClock();

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
    newCorrelations(clock),
  );

  // Framing belongs to whoever lands the text, so what arrives here is exactly
  // what the peer said — a bound channel posts it as the participant's own words.
  assert.equal(capture.reported.length, 1);
  assert.equal(capture.reported[0].text, "found it");
  assert.equal(capture.reported[0].envelope, undefined);
  const content = (res?.result as { content: { text: string }[] }).content;
  assert.match(content[0].text, /Delivered/);
});

test("ask_prime carries a correlation id and no request-id instructions", async () => {
  const registry = new RelayRegistry();
  const channel = registry.get(registry.open({ sessionId: "s1" }).channelId)!;
  const capture = captureReport();
  const { clock } = fakeClock();
  const correlations = newCorrelations(clock);

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
    correlations,
  );
  await tick();

  const correlationId = capture.reported[0].envelope?.correlationId;
  assert.ok(correlationId, "the question carries a correlation id");
  assert.equal(capture.reported[0].text, "which zone?");
  assert.doesNotMatch(capture.reported[0].text, /request_id/);

  correlations.resolve(reply(correlationId, "zone-42"));
  const res = await call;
  const content = (res?.result as { content: { text: string }[] }).content;
  assert.equal(content[0].text, "zone-42");
});

test("ask_prime falls back when no answer arrives in time", async () => {
  const registry = new RelayRegistry();
  const channel = registry.get(registry.open({ sessionId: "s1" }).channelId)!;
  const capture = captureReport();
  const { clock, advance } = fakeClock();

  const call = dispatchMcp(
    registry,
    channel,
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "ask_prime", arguments: { question: "which zone?" } },
    },
    capture.report,
    newCorrelations(clock),
  );
  await tick();
  advance(25_000);

  const res = await call;
  const content = (res?.result as { content: { text: string }[] }).content;
  assert.match(content[0].text, /did not answer in time/);
});

test("notifications receive no response body", async () => {
  const registry = new RelayRegistry();
  const channel = registry.get(registry.open({ sessionId: "s1" }).channelId)!;
  const { clock } = fakeClock();
  const res = await dispatchMcp(
    registry,
    channel,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    captureReport().report,
    newCorrelations(clock),
  );
  assert.equal(res, null);
});
