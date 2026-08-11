import assert from "node:assert/strict";
import { test } from "node:test";

import type { SubagentInfo } from "@tangent/shared/contracts.ts";

import type { PiAgentHandlers } from "../pi/types.ts";
import { ExternalSubagentGateway } from "./externalSubagentGateway.ts";

/** Captures every handler call so tests can assert on them. */
function makeHarness() {
  const rosterUpdates: SubagentInfo[] = [];
  const events: Array<{ agentId: string; type: string }> = [];

  const handlers: PiAgentHandlers = {
    onAgentEvent: (_sessionId, agent, event) =>
      events.push({ agentId: agent.agentId, type: event.type }),
    onSubagentUpdate: (_sessionId, info) => rosterUpdates.push(info),
    onAgentMessage: () => {},
    onSessionStatus: () => {},
  };

  const gateway = new ExternalSubagentGateway(handlers);
  return { gateway, rosterUpdates, events };
}

test("register records a roster entry and surfaces it as active", () => {
  const h = makeHarness();
  const { id } = h.gateway.register("s1", { name: "worker" });

  assert.ok(id);
  assert.equal(h.gateway.hasAgent("s1", id), true);
  assert.deepEqual(
    h.gateway.listSubagents("s1").map((s) => s.id),
    [id],
  );
  const info = h.rosterUpdates.at(-1);
  assert.equal(info?.host, "external");
  assert.equal(info?.status, "active");
});

test("the roster describes an external sub-agent as owned by its bundle tool", () => {
  const h = makeHarness();
  h.gateway.register("s1", { name: "worker" });

  // Tangent creates the far side in `world_spawn` and destroys it in
  // `world_terminate`, so the participant is owned, not attached.
  assert.deepEqual(h.gateway.listSubagents("s1")[0].connector, {
    kind: "external-inbound",
    lifecycle: "owned",
    spawnAuthority: "bundle-tool",
  });
});

test("pushEvent relays a streamed event into the tab", () => {
  const h = makeHarness();
  const { id } = h.gateway.register("s1", { name: "worker" });

  h.gateway.pushEvent("s1", id, { type: "start", messageId: "m1" });
  h.gateway.pushEvent("s1", id, {
    type: "end",
    messageId: "m1",
    content: "done",
    thinking: "",
  });

  assert.deepEqual(
    h.events.map((e) => e.type),
    ["start", "end"],
  );
  assert.ok(h.events.every((e) => e.agentId === id));
});

test("pushEvent is a no-op for an unknown agent", () => {
  const h = makeHarness();
  h.gateway.pushEvent("s1", "nope", { type: "start", messageId: "m1" });
  assert.equal(h.events.length, 0);
});

test("setStatus to a terminal state removes the entry and updates the roster", () => {
  const h = makeHarness();
  const { id } = h.gateway.register("s1", { name: "worker" });

  h.gateway.setStatus("s1", id, "completed");

  assert.equal(h.gateway.hasAgent("s1", id), false);
  assert.deepEqual(h.gateway.listSubagents("s1"), []);
  assert.equal(h.rosterUpdates.at(-1)?.status, "completed");
});

test("setStatus to active keeps the entry in the roster", () => {
  const h = makeHarness();
  const { id } = h.gateway.register("s1", { name: "worker" });

  h.gateway.setStatus("s1", id, "active");

  assert.equal(h.gateway.hasAgent("s1", id), true);
  assert.equal(h.rosterUpdates.at(-1)?.status, "active");
});

test("listSubagents is scoped per session", () => {
  const h = makeHarness();
  const a = h.gateway.register("s1", { name: "one" });
  h.gateway.register("s2", { name: "two" });

  assert.deepEqual(
    h.gateway.listSubagents("s1").map((s) => s.id),
    [a.id],
  );
  assert.equal(h.gateway.listSubagents("s2").length, 1);
});
