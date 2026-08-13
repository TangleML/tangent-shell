import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  capabilitiesForRole,
  type SubagentInfo,
  type UiCommand,
} from "@tangent/shared/contracts.ts";

// Point the session root at a throwaway dir before importing modules that read
// config at load time, so a written artifact never touches the repo.
const ROOT = mkdtempSync(path.join(tmpdir(), "a2a-gateway-"));
process.env.SESSIONS_ROOT = ROOT;

const { PeerBearerCredential } = await import("../connectors/credentials.ts");
const { RunRegistry } = await import("../runs/runRegistry.ts");
const { InMemoryRunStore } = await import("../store/inMemoryRunStore.ts");
const { InMemorySessionStore } =
  await import("../store/inMemorySessionStore.ts");
const { A2aPeerGateway } = await import("./a2aPeerGateway.ts");

type A2aEvent = import("./a2aClient.ts").A2aEvent;
type A2aPeer = import("./a2aClient.ts").A2aPeer;
type A2aSend = import("./a2aClient.ts").A2aSend;
type AgentEvent = import("../pi/types.ts").AgentEvent;
type ConversationEventSink = import("../pi/types.ts").ConversationEventSink;
type SessionAgent = import("../store/sessionStore.ts").SessionAgent;

after(() => rmSync(ROOT, { recursive: true, force: true }));

const ENDPOINT = "https://agent.example.com";

/** What a fake peer was asked to do, so a test can assert on the far end. */
interface PeerLog {
  sends: A2aSend[];
  cancels: string[];
  discoveries: Array<{ endpointUrl: string; headers: Record<string, string> }>;
}

/** How the fake peer behaves: the events it replays, and whether it ends. */
interface PeerBehaviour {
  events?: A2aEvent[];
  /** Discovery throws, as it does for a peer that has moved or gone away. */
  undiscoverable?: boolean;
  /** The stream stays open after its events, until the turn is cancelled. */
  hangs?: boolean;
}

/** Blocks until `signal` aborts, then throws the way `fetch` does. */
function untilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () =>
      reject(new Error("The operation was aborted.")),
    );
  });
}

/**
 * A peer that replays a canned event stream. Injected in place of the SDK, so a
 * test drives the gateway with realistic events and never opens a socket.
 */
function fakePeer(behaviour: PeerBehaviour, log: PeerLog): A2aPeer {
  return {
    card: { name: "Weather", description: "Knows the weather" },
    async *send(input: A2aSend) {
      log.sends.push(input);
      for (const event of behaviour.events ?? []) yield event;
      if (behaviour.hangs) await untilAborted(input.signal);
    },
    async cancel(taskId: string) {
      log.cancels.push(taskId);
    },
  };
}

/** A relayed agent event, reduced to what these tests assert on. */
interface RelayedEvent {
  type: string;
  text?: string;
  runId?: string;
}

/** The text an agent event carries, whichever half of a stream it is. */
function textOfEvent(event: AgentEvent): string | undefined {
  if ("delta" in event) return event.delta;
  if ("content" in event) return event.content;
  return undefined;
}

/** A recording sink, so a test reads exactly what the gateway surfaced. */
function captureSink(): {
  handlers: ConversationEventSink;
  rosterUpdates: SubagentInfo[];
  agentEvents: RelayedEvent[];
  notices: Array<{ conversationId: string; content: string }>;
} {
  const rosterUpdates: SubagentInfo[] = [];
  const agentEvents: RelayedEvent[] = [];
  const notices: Array<{ conversationId: string; content: string }> = [];

  return {
    rosterUpdates,
    agentEvents,
    notices,
    handlers: {
      onAgentEvent: (_sessionId, _agent, event) =>
        agentEvents.push({
          type: event.type,
          text: textOfEvent(event),
          runId: event.runId,
        }),
      onSubagentUpdate: (_sessionId, info) => rosterUpdates.push(info),
      onAgentMessage: ({ conversationId, content }) =>
        notices.push({ conversationId, content }),
      onSessionStatus: () => {},
    },
  };
}

/** A gateway over a fake peer, with every handler call captured. */
function makeHarness(behaviour: PeerBehaviour = {}) {
  const sink = captureSink();
  const uiCommands: UiCommand[] = [];
  const log: PeerLog = { sends: [], cancels: [], discoveries: [] };
  const runStore = new InMemoryRunStore();
  const runs = new RunRegistry(runStore);
  const store = new InMemorySessionStore();
  const gateway = new A2aPeerGateway(
    sink.handlers,
    runs,
    store,
    (_sessionId, command) => uiCommands.push(command),
    new PeerBearerCredential("peer-secret"),
    async (endpointUrl, headers) => {
      log.discoveries.push({ endpointUrl, headers });
      if (behaviour.undiscoverable) throw new Error("card not found");
      return fakePeer(behaviour, log);
    },
  );

  return { ...sink, gateway, store, runs, runStore, log, uiCommands };
}

/** A persisted roster row for an attached peer, as a revive reads one. */
function agentRow(overrides: Partial<SessionAgent> = {}): SessionAgent {
  return {
    id: "peer-1",
    sessionId: "s1",
    role: "subagent",
    name: "Weather",
    capabilities: capabilitiesForRole(overrides.role ?? "subagent"),
    status: "detached",
    connector: {
      kind: "a2a",
      lifecycle: "attached",
      spawnAuthority: "none",
      credentialScheme: "peer-bearer",
      endpointUrl: ENDPOINT,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Waits for the work the gateway started behind `send`, which includes writing
 * a file. Polled rather than counted in ticks so a slower disk cannot flake it.
 */
async function settled(done: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("the turn never finished");
}

test("attach discovers the card, names the tab from it, and persists the endpoint", async () => {
  const h = makeHarness();

  const info = await h.gateway.attach("s1", { endpointUrl: ENDPOINT });

  assert.equal(info.name, "Weather");
  assert.equal(info.connector.kind, "a2a");
  assert.equal(info.connector.endpointUrl, ENDPOINT);
  assert.equal(h.gateway.hasAgent("s1", info.id), true);
  assert.deepEqual(
    h.rosterUpdates.map((r) => r.status),
    ["active"],
  );

  // The credential travels outbound: discovery is Tangent dialling a far end.
  assert.deepEqual(h.log.discoveries, [
    { endpointUrl: ENDPOINT, headers: { Authorization: "Bearer peer-secret" } },
  ]);

  // Awaited, not fired off: a Membership is derived from this row, so a delivery
  // arriving before it landed would find nobody to address.
  const persisted = (await h.store.listAgents("s1")).find(
    (a) => a.id === info.id,
  );
  assert.equal(persisted?.connector.endpointUrl, ENDPOINT);
  assert.equal(persisted?.purpose, "Knows the weather");
});

test("a caller's name wins over the one on the card", async () => {
  const h = makeHarness();
  const info = await h.gateway.attach("s1", {
    endpointUrl: ENDPOINT,
    name: "Forecaster",
  });
  assert.equal(info.name, "Forecaster");
});

test("attach fails when the card cannot be read, leaving no tab behind", async () => {
  const h = makeHarness({ undiscoverable: true });

  await assert.rejects(h.gateway.attach("s1", { endpointUrl: ENDPOINT }));

  assert.deepEqual(h.gateway.listSubagents("s1"), []);
  assert.deepEqual(await h.store.listAgents("s1"), []);
});

test("a peer's stream becomes agent events, one persisted turn and a settled Run", async () => {
  const h = makeHarness({
    events: [
      { kind: "task", taskId: "task-1", phase: "working" },
      {
        kind: "status",
        taskId: "task-1",
        phase: "working",
        text: "Looking...",
      },
      {
        kind: "status",
        taskId: "task-1",
        phase: "completed",
        text: "It rains.",
      },
    ],
  });
  const info = await h.gateway.attach("s1", { endpointUrl: ENDPOINT });

  assert.equal(
    h.gateway.send({ sessionId: "s1", participantId: info.id, text: "hi" }),
    true,
  );
  await settled(() => h.agentEvents.at(-1)?.type === "end");

  assert.deepEqual(
    h.agentEvents.map((e) => e.type),
    ["start", "delta", "delta", "end"],
  );
  assert.equal(h.agentEvents.at(-1)?.text, "Looking...It rains.");

  // The Task is the far side's name for this work, so the Run carries it.
  const runs = await h.runStore.listRuns("s1");
  assert.equal(runs.length, 1);
  assert.equal(runs[0].externalId, "task-1");
  assert.equal(runs[0].status, "completed");
  assert.equal(runs[0].ingress, "reaction");
  assert.equal(h.runs.current("s1", info.id), undefined);
});

test("a Task left waiting for input keeps its id for the next turn", async () => {
  const h = makeHarness({
    events: [
      { kind: "task", taskId: "task-1", phase: "working" },
      {
        kind: "status",
        taskId: "task-1",
        phase: "input-required",
        text: "Which city?",
      },
    ],
  });
  const info = await h.gateway.attach("s1", { endpointUrl: ENDPOINT });

  h.gateway.send({ sessionId: "s1", participantId: info.id, text: "weather?" });
  await settled(() => h.agentEvents.at(-1)?.type === "end");
  h.gateway.send({ sessionId: "s1", participantId: info.id, text: "Berlin" });
  await settled(() => h.log.sends.length === 2);

  // The first turn opened the Task; the second continues it rather than
  // starting a fresh one, which is what a multi-turn A2A exchange is.
  assert.deepEqual(
    h.log.sends.map((send) => send.taskId),
    [undefined, "task-1"],
  );
});

test("a completed Task is not continued: the next turn opens a new one", async () => {
  const h = makeHarness({
    events: [
      { kind: "status", taskId: "task-1", phase: "completed", text: "done" },
    ],
  });
  const info = await h.gateway.attach("s1", { endpointUrl: ENDPOINT });

  h.gateway.send({ sessionId: "s1", participantId: info.id, text: "one" });
  await settled(() => h.log.sends.length === 1);
  h.gateway.send({ sessionId: "s1", participantId: info.id, text: "two" });
  await settled(() => h.log.sends.length === 2);

  assert.deepEqual(
    h.log.sends.map((send) => send.taskId),
    [undefined, undefined],
  );
});

test("an artifact is written under the session root and pinned", async () => {
  const h = makeHarness({
    events: [
      {
        kind: "artifact",
        taskId: "task-1",
        artifact: {
          name: "forecast",
          parts: [{ filename: "forecast.txt", body: "rain tomorrow" }],
        },
      },
      { kind: "status", taskId: "task-1", phase: "completed", text: "done" },
    ],
  });
  const session = await h.store.createSession({ name: "S" });
  const info = await h.gateway.attach(session.id, { endpointUrl: ENDPOINT });

  h.gateway.send({
    sessionId: session.id,
    participantId: info.id,
    text: "forecast?",
  });
  await settled(() => h.uiCommands.length === 1);

  const artifacts = await h.store.getArtifacts(session.id);
  assert.deepEqual(
    artifacts.map((a) => [a.path, a.title]),
    [[path.join("a2a", "task-1", "forecast.txt"), "forecast"]],
  );
  assert.equal(
    readFileSync(path.join(session.rootPath, artifacts[0].path), "utf8"),
    "rain tomorrow",
  );
  assert.deepEqual(
    h.uiCommands.map((c) => c.kind),
    ["artifacts.update"],
  );
});

test("cancel aborts the local stream and reaches the peer's Task", async () => {
  // A peer that keeps working after its first output, so there is something to
  // cancel: without a hanging stream the turn would already be over.
  const h = makeHarness({
    events: [
      { kind: "task", taskId: "task-1", phase: "working" },
      { kind: "status", taskId: "task-1", phase: "working", text: "thinking" },
    ],
    hangs: true,
  });
  const info = await h.gateway.attach("s1", { endpointUrl: ENDPOINT });

  h.gateway.send({ sessionId: "s1", participantId: info.id, text: "hi" });
  await settled(() => h.agentEvents.at(-1)?.type === "delta");
  const cancelled = h.gateway.cancel("s1", info.id);
  await settled(() => h.agentEvents.at(-1)?.type === "end");

  assert.equal(cancelled, true);
  assert.deepEqual(h.log.cancels, ["task-1"]);
  // The partial reply is persisted as history that provokes nobody, and the Run
  // records that it was cancelled rather than that it failed.
  const runs = await h.runStore.listRuns("s1");
  assert.equal(runs[0].status, "cancelled");
  assert.equal(h.agentEvents.at(-1)?.text, "thinking");
});

test("cancelling a peer with nothing running is refused", async () => {
  const h = makeHarness();
  const info = await h.gateway.attach("s1", { endpointUrl: ENDPOINT });

  assert.equal(h.gateway.cancel("s1", info.id), false);
  assert.equal(h.gateway.cancel("s1", "ghost"), false);
  assert.deepEqual(h.log.cancels, []);
});

test("reattach restores a persisted tab as detached without dialling anyone", () => {
  const h = makeHarness();

  h.gateway.reattach("s1", agentRow());

  assert.equal(h.gateway.hasAgent("s1", "peer-1"), true);
  assert.equal(h.rosterUpdates.at(-1)?.status, "detached");
  assert.equal(h.rosterUpdates.at(-1)?.connector.endpointUrl, ENDPOINT);
  // A peer is a service that may well be gone; a restart is no reason to wake it.
  assert.deepEqual(h.log.discoveries, []);
});

test("a row with no endpoint is not restorable", () => {
  const h = makeHarness();

  h.gateway.reattach(
    "s1",
    agentRow({
      connector: {
        kind: "a2a",
        lifecycle: "attached",
        spawnAuthority: "none",
        credentialScheme: "peer-bearer",
      },
    }),
  );

  assert.equal(h.gateway.hasAgent("s1", "peer-1"), false);
});

test("a detached peer re-discovers on the next delivery and goes active", async () => {
  const h = makeHarness({
    events: [
      { kind: "status", taskId: "task-1", phase: "completed", text: "back" },
    ],
  });
  h.gateway.reattach("s1", agentRow());

  h.gateway.send({
    sessionId: "s1",
    participantId: "peer-1",
    text: "still up?",
  });
  await settled(() => h.agentEvents.at(-1)?.type === "end");

  assert.deepEqual(
    h.log.discoveries.map((d) => d.endpointUrl),
    [ENDPOINT],
  );
  assert.equal(h.rosterUpdates.at(-1)?.status, "active");
  assert.equal(h.agentEvents.at(-1)?.text, "back");
});

test("a peer that cannot be re-discovered refuses in its own thread", async () => {
  const h = makeHarness({ undiscoverable: true });
  h.gateway.reattach("s1", agentRow());

  // Accepted by the connector and refused later: an A2A turn is a request the
  // sender does not wait on, so an unreachable far end explains itself here.
  assert.equal(
    h.gateway.send({
      sessionId: "s1",
      participantId: "peer-1",
      text: "still up?",
    }),
    true,
  );
  await settled(() => h.notices.length === 1);

  assert.equal(h.notices.at(-1)?.conversationId, "peer-1");
  assert.match(h.notices.at(-1)?.content ?? "", /Couldn't reach Weather/);
  assert.equal(h.rosterUpdates.at(-1)?.status, "detached");
  assert.deepEqual(await h.runStore.listRuns("s1"), []);
});

test("send is refused for a participant this gateway does not hold", () => {
  const h = makeHarness();

  assert.equal(
    h.gateway.send({ sessionId: "s1", participantId: "ghost", text: "hi" }),
    false,
  );
  assert.deepEqual(h.notices, []);
});

test("detach ends the attachment and the Task, not the agent", async () => {
  const h = makeHarness({
    events: [
      { kind: "task", taskId: "task-1", phase: "working" },
      { kind: "status", taskId: "task-1", phase: "working", text: "thinking" },
    ],
    hangs: true,
  });
  const info = await h.gateway.attach("s1", { endpointUrl: ENDPOINT });
  h.gateway.send({ sessionId: "s1", participantId: info.id, text: "hi" });
  await settled(() => h.agentEvents.at(-1)?.type === "delta");

  h.gateway.detach("s1", info.id, true);
  await settled(() => h.log.cancels.length === 1);

  assert.equal(h.gateway.hasAgent("s1", info.id), false);
  assert.equal(h.rosterUpdates.at(-1)?.status, "completed");
  assert.deepEqual(h.log.cancels, ["task-1"]);
  const runs = await h.runStore.listRuns("s1");
  assert.equal(runs[0].status, "completed");
});
