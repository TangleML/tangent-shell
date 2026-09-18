import assert from "node:assert/strict";
import { test } from "node:test";

import {
  capabilitiesForRole,
  type SubagentInfo,
} from "@tangent/shared/contracts.ts";

import { RelayRegistry } from "../mcp/relayRegistry.ts";
import type { ConversationEventSink } from "../pi/types.ts";
import { RunRegistry } from "../runs/runRegistry.ts";
import { InMemoryRunStore } from "../store/inMemoryRunStore.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import type { SessionAgent } from "../store/sessionStore.ts";
import { ExternalSubagentGateway } from "./externalSubagentGateway.ts";

/** Captures every handler call so tests can assert on them. */
function makeHarness() {
  const rosterUpdates: SubagentInfo[] = [];
  const events: Array<{ agentId: string; type: string; runId?: string }> = [];

  const handlers: ConversationEventSink = {
    onAgentEvent: (_sessionId, agent, event) =>
      events.push({
        agentId: agent.agentId,
        type: event.type,
        runId: event.runId,
      }),
    onSubagentUpdate: (_sessionId, info) => rosterUpdates.push(info),
    onAgentMessage: () => {},
    onSessionStatus: () => {},
  };

  const runStore = new InMemoryRunStore();
  const runs = new RunRegistry(runStore);
  const store = new InMemorySessionStore();
  const relay = new RelayRegistry();
  const gateway = new ExternalSubagentGateway(handlers, runs, store, relay);
  return { gateway, rosterUpdates, events, runs, runStore, store, relay };
}

/** A persisted roster row, as a reattach reads one. */
function agentRow(id: string, overrides: Partial<SessionAgent> = {}) {
  return {
    id,
    sessionId: "s1",
    role: "subagent",
    name: "worker",
    capabilities: capabilitiesForRole(overrides.role ?? "subagent"),
    status: "detached",
    connector: {
      kind: "external-inbound",
      lifecycle: "owned",
      spawnAuthority: "bundle-tool",
      credentialScheme: "internal-bearer",
    },
    homeConversationId: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } satisfies SessionAgent;
}

test("register records a roster entry and surfaces it as active", async () => {
  const h = makeHarness();
  const { id } = await h.gateway.register("s1", { name: "worker" });

  assert.ok(id);
  assert.equal(h.gateway.hasAgent("s1", id), true);
  assert.deepEqual(
    h.gateway.listSubagents("s1").map((s) => s.id),
    [id],
  );
  const info = h.rosterUpdates.at(-1);
  assert.equal(info?.connector.kind, "external-inbound");
  assert.equal(info?.status, "active");
});

test("register persists a roster row so a restart has something to reattach to", async () => {
  const h = makeHarness();
  const { id } = await h.gateway.register("s1", {
    name: "worker",
    model: "claude",
    template: "researcher",
  });

  const persisted = (await h.store.listAgents("s1")).find((a) => a.id === id);
  assert.ok(persisted);
  assert.equal(persisted.role, "subagent");
  assert.equal(persisted.name, "worker");
  assert.equal(persisted.status, "active");
  assert.equal(persisted.model, "claude");
  assert.equal(persisted.template, "researcher");
  assert.equal(persisted.connector.kind, "external-inbound");
});

test("reattach restores a persisted tab as detached", () => {
  const h = makeHarness();

  h.gateway.reattach("s1", agentRow("ext-1", { model: "claude" }));

  assert.equal(h.gateway.hasAgent("s1", "ext-1"), true);
  const info = h.gateway.listSubagents("s1")[0];
  assert.equal(info.status, "detached");
  assert.equal(info.model, "claude");
  assert.equal(info.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(h.rosterUpdates.at(-1)?.status, "detached");
});

test("a detached tab reattaches when the far side pushes its next turn", () => {
  const h = makeHarness();
  h.gateway.reattach("s1", agentRow("ext-1"));

  h.gateway.pushEvent("s1", "ext-1", { type: "start", messageId: "m1" });

  assert.equal(h.gateway.listSubagents("s1")[0].status, "active");
  assert.deepEqual(
    h.events.map((e) => e.type),
    ["start"],
  );
});

test("reattach never downgrades a live tab", async () => {
  const h = makeHarness();
  const { id } = await h.gateway.register("s1", { name: "worker" });
  const updatesBefore = h.rosterUpdates.length;

  h.gateway.reattach("s1", agentRow(id, { status: "active" }));

  assert.equal(h.gateway.listSubagents("s1")[0].status, "active");
  assert.equal(h.rosterUpdates.length, updatesBefore, "no roster churn");
});

test("setStatus to detached keeps the entry, unlike a terminal status", async () => {
  const h = makeHarness();
  const { id } = await h.gateway.register("s1", { name: "worker" });

  h.gateway.setStatus("s1", id, "detached");

  assert.equal(h.gateway.hasAgent("s1", id), true);
  assert.equal(h.rosterUpdates.at(-1)?.status, "detached");
});

test("the roster describes an external sub-agent as owned by its bundle tool", async () => {
  const h = makeHarness();
  await h.gateway.register("s1", { name: "worker" });

  // Tangent creates the far side in `world_spawn` and destroys it in
  // `world_terminate`, so the participant is owned, not attached.
  assert.deepEqual(h.gateway.listSubagents("s1")[0].connector, {
    kind: "external-inbound",
    lifecycle: "owned",
    spawnAuthority: "bundle-tool",
    credentialScheme: "internal-bearer",
  });
});

test("pushEvent relays a streamed event into the tab", async () => {
  const h = makeHarness();
  const { id } = await h.gateway.register("s1", { name: "worker" });

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

test("setStatus to a terminal state removes the entry and updates the roster", async () => {
  const h = makeHarness();
  const { id } = await h.gateway.register("s1", { name: "worker" });

  h.gateway.setStatus("s1", id, "completed");

  assert.equal(h.gateway.hasAgent("s1", id), false);
  assert.deepEqual(h.gateway.listSubagents("s1"), []);
  assert.equal(h.rosterUpdates.at(-1)?.status, "completed");
});

test("setStatus to active keeps the entry in the roster", async () => {
  const h = makeHarness();
  const { id } = await h.gateway.register("s1", { name: "worker" });

  h.gateway.setStatus("s1", id, "active");

  assert.equal(h.gateway.hasAgent("s1", id), true);
  assert.equal(h.rosterUpdates.at(-1)?.status, "active");
});

test("a turn's run carries the far side's session id and drain cursor", async () => {
  const h = makeHarness();
  const { id } = await h.gateway.register("s1", { name: "worker" });

  const runId = h.gateway.openRun("s1", id, {
    externalId: "aquifer-1",
    cursor: "7",
  });
  assert.ok(runId);
  h.gateway.pushEvent("s1", id, { type: "start", messageId: "m1" });
  h.gateway.endRun("s1", id, "completed", { runId, cursor: "31" });

  assert.equal(h.events.at(-1)?.runId, runId);
  const stored = await h.runStore.getRun(runId);
  assert.equal(stored?.externalId, "aquifer-1");
  assert.equal(stored?.cursor, "31");
  assert.equal(stored?.status, "completed");
  assert.equal(stored?.ingress, "tool");
});

test("an event with no run id is attributed to the tab's open run", async () => {
  const h = makeHarness();
  const { id } = await h.gateway.register("s1", { name: "worker" });
  const runId = h.gateway.openRun("s1", id);

  h.gateway.pushEvent("s1", id, { type: "activity", activity: null });

  assert.equal(h.events.at(-1)?.runId, runId);
});

test("a run id belonging to another tab is not honored", async () => {
  const h = makeHarness();
  const mine = await h.gateway.register("s1", { name: "mine" });
  const theirs = await h.gateway.register("s1", { name: "theirs" });
  const theirRun = h.gateway.openRun("s1", theirs.id);
  const myRun = h.gateway.openRun("s1", mine.id);

  h.gateway.pushEvent(
    "s1",
    mine.id,
    { type: "start", messageId: "m1" },
    theirRun,
  );

  assert.equal(h.events.at(-1)?.runId, myRun);
});

test("a tab going terminal settles the run it was working under", async () => {
  const h = makeHarness();
  const { id } = await h.gateway.register("s1", { name: "worker" });
  const runId = h.gateway.openRun("s1", id);
  assert.ok(runId);

  h.gateway.setStatus("s1", id, "error");

  assert.equal(h.runs.current("s1", id), undefined);
  assert.equal((await h.runStore.getRun(runId))?.status, "failed");
});

test("openRun refuses an unknown agent", () => {
  const h = makeHarness();
  assert.equal(h.gateway.openRun("s1", "nope"), undefined);
});

test("register opens a callback channel bound to the new participant", async () => {
  const h = makeHarness();
  const { id, callback } = await h.gateway.register("s1", { name: "worker" });

  const channel = h.relay.get(callback.channelId);
  assert.equal(channel?.sessionId, "s1");
  assert.equal(channel?.participantId, id, "the channel speaks for the tab");
  assert.equal(channel?.label, "worker");
  assert.equal(
    channel?.credential.verify({ authorization: `Bearer ${callback.secret}` }),
    true,
  );
});

test("a terminal status closes the tab's callback channel", async () => {
  const h = makeHarness();
  const { id, callback } = await h.gateway.register("s1", { name: "worker" });

  h.gateway.setStatus("s1", id, "completed");

  assert.equal(h.relay.get(callback.channelId), undefined);
});

test("a detached tab keeps its channel, because it has something to come back to", async () => {
  const h = makeHarness();
  const { id, callback } = await h.gateway.register("s1", { name: "worker" });

  h.gateway.setStatus("s1", id, "detached");

  assert.ok(h.relay.get(callback.channelId));
});

test("a delivery is queued for the driver that next asks for it", async () => {
  const h = makeHarness();
  const { id } = await h.gateway.register("s1", { name: "worker" });

  assert.equal(h.gateway.deliver("s1", id, "do the thing"), true);

  assert.deepEqual(await h.gateway.takeDeliveries("s1", 5), [
    { agentId: id, text: "do the thing" },
  ]);
});

test("a parked poll is answered by a delivery that arrives after it", async () => {
  const h = makeHarness();
  const { id } = await h.gateway.register("s1", { name: "worker" });

  const polled = h.gateway.takeDeliveries("s1", 5_000);
  h.gateway.deliver("s1", id, "do the thing");

  assert.deepEqual(await polled, [{ agentId: id, text: "do the thing" }]);
});

test("a poll with nothing queued is answered empty", async () => {
  const h = makeHarness();
  assert.deepEqual(await h.gateway.takeDeliveries("s1", 5), []);
});

test("nothing is queued for an unknown or detached tab", async () => {
  const h = makeHarness();
  const { id } = await h.gateway.register("s1", { name: "worker" });
  h.gateway.setStatus("s1", id, "detached");

  assert.equal(h.gateway.deliver("s1", "nope", "hello"), false);
  assert.equal(h.gateway.deliver("s1", id, "hello"), false);
});

test("a tab going terminal discards what was queued for it", async () => {
  const h = makeHarness();
  const gone = await h.gateway.register("s1", { name: "gone" });
  const kept = await h.gateway.register("s1", { name: "kept" });
  h.gateway.deliver("s1", gone.id, "lost");
  h.gateway.deliver("s1", kept.id, "still wanted");

  h.gateway.setStatus("s1", gone.id, "completed");

  assert.deepEqual(await h.gateway.takeDeliveries("s1", 5), [
    { agentId: kept.id, text: "still wanted" },
  ]);
});

test("listSubagents is scoped per session", async () => {
  const h = makeHarness();
  const a = await h.gateway.register("s1", { name: "one" });
  await h.gateway.register("s2", { name: "two" });

  assert.deepEqual(
    h.gateway.listSubagents("s1").map((s) => s.id),
    [a.id],
  );
  assert.equal(h.gateway.listSubagents("s2").length, 1);
});
