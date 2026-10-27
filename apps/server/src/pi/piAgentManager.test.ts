import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, mock, test } from "node:test";

import {
  capabilitiesForRole,
  connectorFor,
} from "@tangent/shared/contracts.ts";

import { RunRegistry } from "../runs/runRegistry.ts";
import { InMemoryRunStore } from "../store/inMemoryRunStore.ts";
import type { SessionAgent } from "../store/sessionStore.ts";
import type { MemoryManager } from "./memory.ts";
import { PiAgentManager, PRIME_AGENT_ID } from "./piAgentManager.ts";
import type { ConversationEventSink } from "./types.ts";

/**
 * Minimal stand-in for a Pi child process. It records stdin writes and lets a
 * test drive lifecycle events (`crash`) deterministically without a real binary.
 */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly writes: string[] = [];
  killed = false;
  readonly stdin = {
    write: (chunk: string): boolean => {
      this.writes.push(chunk);
      return true;
    },
  };

  kill(): boolean {
    this.killed = true;
    return true;
  }

  /** Simulates an unexpected process exit (a crash). */
  crash(): void {
    this.emit("exit", 1, null);
  }
}

interface SpawnRecord {
  args: string[];
  agentId: string | undefined;
  env: NodeJS.ProcessEnv | undefined;
  child: FakeChild;
}

/** One relayed agent event, reduced to what the run tests assert on. */
interface RelayedEvent {
  agentId: string;
  type: string;
  runId?: string;
}

/** Builds a manager wired to a fake launcher; returns it plus the spawn log. */
function makeManager(): {
  pi: PiAgentManager;
  spawns: SpawnRecord[];
  rosterUpdates: { id: string; status: string }[];
  events: RelayedEvent[];
  runs: RunRegistry;
  runStore: InMemoryRunStore;
} {
  const spawns: SpawnRecord[] = [];
  const rosterUpdates: { id: string; status: string }[] = [];
  const events: RelayedEvent[] = [];

  const fakeSpawn = ((
    _command: string,
    args: string[],
    options: { env?: NodeJS.ProcessEnv },
  ) => {
    const child = new FakeChild();
    spawns.push({
      args,
      agentId: options?.env?.TANGENT_AGENT_ID,
      env: options?.env,
      child,
    });
    return child as unknown as ChildProcessWithoutNullStreams;
  }) as unknown as typeof spawn;

  const handlers: ConversationEventSink = {
    onAgentEvent: (_sessionId, agent, event) =>
      events.push({
        agentId: agent.agentId,
        type: event.type,
        runId: event.runId,
      }),
    onSubagentUpdate: (_sessionId, subagent) =>
      rosterUpdates.push({ id: subagent.id, status: subagent.status }),
    onAgentMessage: () => {},
    onSessionStatus: () => {},
  };

  const memory = {
    initSession: () => {},
    buildPreamble: () => "## Memory\n\n(empty)",
  } as unknown as MemoryManager;

  const runStore = new InMemoryRunStore();
  const runs = new RunRegistry(runStore);
  const pi = new PiAgentManager(handlers, memory, runs, undefined, fakeSpawn);
  return { pi, spawns, rosterUpdates, events, runs, runStore };
}

/** A persisted roster row with sane defaults, overridable per field. */
function agentRow(overrides: Partial<SessionAgent>): SessionAgent {
  return {
    id: "agent-1",
    sessionId: "s1",
    role: "subagent",
    name: "Worker",
    capabilities: capabilitiesForRole(overrides.role ?? "subagent"),
    status: "active",
    autoRelayToPrime: true,
    connector: connectorFor("pi-stdio"),
    homeConversationId: "agent-1",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Creates a throwaway session root and removes it after `fn`. */
function withTempRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-pi-manager-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test("reviveSubagent re-spawns a sub-agent from its persisted config", () => {
  const { pi, spawns } = makeManager();
  pi.ensure("s1", "/tmp/s1");
  assert.equal(spawns.length, 1, "ensure spawns Prime");

  pi.reviveSubagent(
    "s1",
    agentRow({
      id: "sub-active",
      name: "Scout",
      status: "active",
      tools: ["read", "grep"],
      systemPrompt: "You are Scout.",
    }),
  );

  assert.equal(spawns.length, 2, "the sub-agent is revived");
  const revived = spawns[1];
  assert.equal(revived.agentId, "sub-active");
  assert.ok(
    revived.args.includes("read,grep"),
    "revived process uses the persisted tool allowlist",
  );
  assert.deepEqual(
    pi.listSubagents("s1").map((s) => s.id),
    ["sub-active"],
  );

  // The original task is NOT re-delivered: the revived process gets no stdin.
  assert.equal(
    revived.child.writes.length,
    0,
    "no task re-delivered on revive",
  );
});

test("reviveSubagent restores a detached row, and refuses Prime and terminal ones", () => {
  const { pi, spawns } = makeManager();
  pi.ensure("s1", "/tmp/s1");

  // `detached` is the ordinary pre-revive state: the boot reconciliation puts
  // every stale row there, so revive has to accept it.
  pi.reviveSubagent("s1", agentRow({ id: "sub-detached", status: "detached" }));
  pi.reviveSubagent("s1", agentRow({ id: "sub-killed", status: "killed" }));
  pi.reviveSubagent("s1", agentRow({ id: "sub-done", status: "completed" }));
  pi.reviveSubagent(
    "s1",
    agentRow({ id: PRIME_AGENT_ID, role: "prime", name: "Prime" }),
  );

  assert.equal(spawns.length, 2, "only the detached row is revived");
  assert.deepEqual(
    pi.listSubagents("s1").map((s) => s.id),
    ["sub-detached"],
  );
});

test("reviveSubagent is idempotent and skips an already-live agent", () => {
  const { pi, spawns } = makeManager();
  pi.ensure("s1", "/tmp/s1");

  const persisted = agentRow({
    id: "sub-active",
    status: "active",
    tools: ["read"],
    systemPrompt: "prompt",
  });
  pi.reviveSubagent("s1", persisted);
  pi.reviveSubagent("s1", persisted);

  assert.equal(spawns.length, 2, "second revive does not double-spawn");
});

test("ensure falls back when an installed bundle config cannot be reloaded", () => {
  withTempRoot((root) => {
    const { pi, spawns } = makeManager();
    const warn = mock.method(console, "warn", () => {});
    mkdirSync(path.join(root, ".tangent"));
    writeFileSync(
      path.join(root, ".tangent", "tangent.yaml"),
      "not: valid: yaml",
    );

    assert.doesNotThrow(() => pi.ensure("s1", root));

    assert.equal(spawns.length, 1, "ensure still spawns Prime");
    assert.ok(
      warn.mock.calls.some((call) =>
        String(call.arguments[0]).includes("failed to load installed bundle"),
      ),
      "expected corrupt bundle reload to be logged",
    );
  });
});

test("supervisor auto-respawns a crashed agent with backoff, then gives up", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { pi, spawns } = makeManager();
  pi.ensure("s1", "/tmp/s1");
  assert.equal(spawns.length, 1);

  // Crash #1 -> respawn after 1s.
  spawns[0].child.crash();
  assert.equal(spawns.length, 1, "respawn is deferred by backoff");
  mock.timers.tick(1_000);
  assert.equal(spawns.length, 2, "respawned after backoff");

  // Crash #2 -> 2s, Crash #3 -> 4s.
  spawns[1].child.crash();
  mock.timers.tick(2_000);
  assert.equal(spawns.length, 3);
  spawns[2].child.crash();
  mock.timers.tick(4_000);
  assert.equal(spawns.length, 4);

  // Crash #4 -> budget exhausted, no further respawn, slot dropped.
  spawns[3].child.crash();
  mock.timers.tick(10_000);
  assert.equal(spawns.length, 4, "supervisor gives up after the retry budget");
  assert.equal(pi.hasAgent("s1", PRIME_AGENT_ID), false);
});

test("the local roster describes its connector", () => {
  const { pi } = makeManager();
  pi.ensure("s1", "/tmp/s1");
  const { info } = pi.spawnSubagent("s1", { name: "Worker" });

  const expected = {
    kind: "pi-stdio",
    lifecycle: "owned",
    spawnAuthority: "server",
    credentialScheme: "inherited-token",
  };
  assert.deepEqual(info.connector, expected);
  assert.deepEqual(pi.listSubagents("s1")[0].connector, expected);
});

/** Feeds one Pi stdout event into an agent's reader. */
function emitPi(child: FakeChild, event: Record<string, unknown>): void {
  child.stdout.emit("data", Buffer.from(`${JSON.stringify(event)}\n`));
}

/** Drives a full Pi turn: one assistant message from `agent_start` to `agent_end`. */
function runTurn(child: FakeChild, text: string): void {
  emitPi(child, { type: "agent_start" });
  emitPi(child, { type: "message_start", message: { role: "assistant" } });
  emitPi(child, {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: text },
  });
  emitPi(child, {
    type: "message_end",
    message: { role: "assistant", content: text },
  });
  emitPi(child, { type: "agent_end" });
}

/** The id of the last RPC command written to an agent's stdin. */
function lastCommandId(child: FakeChild): string {
  const lines = child.writes.join("").trim().split("\n");
  return JSON.parse(lines[lines.length - 1]).id;
}

/** Yields to the microtask queue so write-through persistence has landed. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("a prompt opens one run and every event in the turn carries its id", async () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");

  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "hello" });
  const runId = h.runs.current("s1", PRIME_AGENT_ID)?.id;
  assert.ok(runId, "prompting an idle agent opens a run");

  runTurn(h.spawns[0].child, "hi there");
  await flush();

  const relayed = h.events.filter((e) => e.agentId === PRIME_AGENT_ID);
  assert.deepEqual(
    relayed.map((e) => e.type),
    [
      "activity",
      "activity",
      "start",
      "activity",
      "delta",
      "end",
      "activity",
      "activity",
    ],
  );
  assert.ok(
    relayed.every((e) => e.runId === runId),
    "every event of the turn is attributed to the one run",
  );
  assert.equal((await h.runStore.getRun(runId))?.status, "completed");
});

test("prompting an idle agent shows warming up until Pi reports agent_start", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const labels = () =>
    h.pi.listActivities("s1").map((entry) => entry.activity.label);

  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "hello" });
  assert.deepEqual(labels(), ["Warming up..."]);

  emitPi(h.spawns[0].child, { type: "agent_start" });
  assert.deepEqual(labels(), ["Thinking..."]);
});

test("a crash before agent_start clears the warming up indicator", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");

  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "hello" });
  h.spawns[0].child.crash();

  assert.deepEqual(h.pi.listActivities("s1"), []);
});

test("a prompt Pi rejects fails the run instead of reading busy forever", async () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");

  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "hello" });
  const runId = h.runs.current("s1", PRIME_AGENT_ID)?.id;
  assert.ok(runId);
  emitPi(h.spawns[0].child, {
    type: "response",
    id: lastCommandId(h.spawns[0].child),
    command: "prompt",
    success: false,
    error: "No API key found",
  });
  await flush();

  assert.deepEqual(h.pi.listActivities("s1"), []);
  assert.ok(h.events.some((e) => e.type === "error"));
  assert.equal((await h.runStore.getRun(runId))?.status, "failed");
  assert.equal(h.pi.abort("s1", PRIME_AGENT_ID), false, "the agent is idle");
});

test("a prompt Pi never answers restarts the agent and fails the run", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");

  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "hello" });
  const runId = h.runs.current("s1", PRIME_AGENT_ID)?.id;
  assert.ok(runId);
  t.mock.timers.tick(59_999);
  assert.equal(h.spawns[0].child.killed, false);

  t.mock.timers.tick(1);
  await flush();

  assert.equal(h.spawns[0].child.killed, true);
  assert.deepEqual(h.pi.listActivities("s1"), []);
  assert.equal((await h.runStore.getRun(runId))?.status, "failed");

  h.spawns[0].child.crash();
  t.mock.timers.tick(1_000);
  assert.equal(h.spawns.length, 2, "the supervisor respawns the agent");
});

test("a model change mid-warm-up stands the prompt watchdog down", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");

  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "hello" });
  h.pi.setAgentModel("s1", PRIME_AGENT_ID, { model: "other-model" });
  const errors = t.mock.method(console, "error", () => {});
  t.mock.timers.tick(120_000);

  assert.equal(h.spawns.length, 2);
  assert.equal(h.spawns[1].child.killed, false);
  assert.equal(errors.mock.callCount(), 0);
});

for (const type of ["agent_start", "compaction_start"]) {
  test(`${type} stands the prompt watchdog down`, (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const h = makeManager();
    h.pi.ensure("s1", "/tmp/s1");

    h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "hi" });
    emitPi(h.spawns[0].child, { type });
    t.mock.timers.tick(120_000);

    assert.equal(h.spawns[0].child.killed, false);
    assert.ok(h.runs.current("s1", PRIME_AGENT_ID));
  });
}

/** Emits Pi's acceptance of the last prompt written to `child`. */
function ackPrompt(child: FakeChild): void {
  emitPi(child, {
    type: "response",
    id: lastCommandId(child),
    command: "prompt",
    success: true,
  });
}

test("an accepted prompt followed by agent_start keeps the run going", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");

  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "hello" });
  ackPrompt(h.spawns[0].child);
  t.mock.timers.tick(4_999);
  emitPi(h.spawns[0].child, { type: "agent_start" });
  t.mock.timers.tick(120_000);

  assert.equal(h.spawns[0].child.killed, false);
  assert.ok(h.runs.current("s1", PRIME_AGENT_ID));
  assert.deepEqual(
    h.pi.listActivities("s1").map((entry) => entry.activity.label),
    ["Thinking..."],
  );
});

test("an accepted prompt that starts no turn ends the run", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");

  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "/cmd" });
  const runId = h.runs.current("s1", PRIME_AGENT_ID)?.id;
  assert.ok(runId);
  ackPrompt(h.spawns[0].child);
  t.mock.timers.tick(4_999);
  assert.ok(h.runs.current("s1", PRIME_AGENT_ID));

  t.mock.timers.tick(1);
  await flush();

  assert.equal(h.spawns[0].child.killed, false);
  assert.deepEqual(h.pi.listActivities("s1"), []);
  assert.equal(h.pi.abort("s1", PRIME_AGENT_ID), false, "the agent is idle");
  assert.equal((await h.runStore.getRun(runId))?.status, "completed");
});

test("a compaction before an accepted prompt still ends a turnless run", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");

  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "/cmd" });
  const promptId = lastCommandId(h.spawns[0].child);
  emitPi(h.spawns[0].child, { type: "compaction_start" });
  emitPi(h.spawns[0].child, {
    type: "response",
    id: promptId,
    command: "prompt",
    success: true,
  });
  t.mock.timers.tick(5_000);

  assert.equal(h.runs.current("s1", PRIME_AGENT_ID), undefined);
});

test("a rejected mid-run message does not fail the run in flight", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");

  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "first" });
  emitPi(h.spawns[0].child, { type: "agent_start" });
  h.pi.sendToAgent({
    sessionId: "s1",
    agentId: PRIME_AGENT_ID,
    text: "and also this",
  });
  emitPi(h.spawns[0].child, {
    type: "response",
    id: lastCommandId(h.spawns[0].child),
    command: "prompt",
    success: false,
    error: "rejected",
  });

  assert.ok(h.runs.current("s1", PRIME_AGENT_ID));
  assert.deepEqual(
    h.pi.listActivities("s1").map((entry) => entry.activity.label),
    ["Thinking..."],
  );
});

test("a message delivered mid-run does not re-emit thinking", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");

  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "first" });
  h.pi.sendToAgent({
    sessionId: "s1",
    agentId: PRIME_AGENT_ID,
    text: "and also this",
  });

  assert.equal(h.events.filter((e) => e.type === "activity").length, 1);
});

test("a message delivered mid-run joins the run in flight", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");

  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "first" });
  const runId = h.runs.current("s1", PRIME_AGENT_ID)?.id;
  h.pi.sendToAgent({
    sessionId: "s1",
    agentId: PRIME_AGENT_ID,
    text: "and also this",
  });

  assert.equal(
    h.runs.current("s1", PRIME_AGENT_ID)?.id,
    runId,
    "a steer/follow-up is part of the turn Pi is already taking",
  );
});

test("aborting a run settles it as cancelled, not completed", async () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  h.pi.sendToAgent({
    sessionId: "s1",
    agentId: PRIME_AGENT_ID,
    text: "long job",
  });
  const runId = h.runs.current("s1", PRIME_AGENT_ID)?.id;
  assert.ok(runId);

  assert.equal(h.pi.abort("s1", PRIME_AGENT_ID), true);
  emitPi(h.spawns[0].child, { type: "agent_end" });
  await flush();

  assert.equal(h.runs.current("s1", PRIME_AGENT_ID), undefined);
  assert.equal((await h.runStore.getRun(runId))?.status, "cancelled");
});

test("abort during warm-up cancels the run once it starts", async () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;
  const aborts = () =>
    child.writes.filter((line) => JSON.parse(line).type === "abort").length;

  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "hello" });
  const runId = h.runs.current("s1", PRIME_AGENT_ID)?.id;
  assert.ok(runId);
  assert.equal(h.pi.abort("s1", PRIME_AGENT_ID), true);
  assert.equal(aborts(), 1);

  emitPi(child, { type: "agent_start" });
  assert.equal(aborts(), 2, "the abort is resent once Pi's run exists");
  emitPi(child, { type: "agent_end" });
  await flush();

  assert.equal((await h.runStore.getRun(runId))?.status, "cancelled");
});

test("aborting an idle agent refuses instead of cancelling nothing", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");

  assert.equal(h.pi.abort("s1", PRIME_AGENT_ID), false);
  assert.equal(h.pi.abort("s1", "ghost"), false);
});

test("a turn Pi starts on its own still gets a run", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");

  emitPi(h.spawns[0].child, { type: "agent_start" });

  assert.ok(h.runs.current("s1", PRIME_AGENT_ID));
});

test("a crash fails the run that was in flight", async () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "work" });
  const runId = h.runs.current("s1", PRIME_AGENT_ID)?.id;
  assert.ok(runId);

  h.spawns[0].child.crash();
  await flush();

  assert.equal((await h.runStore.getRun(runId))?.status, "failed");
});

test("a spawn alone opens no run; the task that follows does", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");

  const { info } = h.pi.spawnSubagent("s1", { name: "Worker" });
  assert.equal(
    h.runs.current("s1", info.id),
    undefined,
    "a sub-agent with nothing to do yet is not working",
  );

  h.pi.sendToAgent({
    sessionId: "s1",
    agentId: info.id,
    text: "go",
    ingress: "tool",
  });

  assert.equal(h.runs.current("s1", info.id)?.ingress, "tool");
});

test("killing a sub-agent mid-run cancels its run", async () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const { info } = h.pi.spawnSubagent("s1", { name: "Worker" });
  h.pi.sendToAgent({
    sessionId: "s1",
    agentId: info.id,
    text: "go",
    ingress: "tool",
  });
  const runId = h.runs.current("s1", info.id)?.id;
  assert.ok(runId);

  h.pi.killAgent("s1", info.id);
  await flush();

  assert.equal((await h.runStore.getRun(runId))?.status, "cancelled");
});

test("an intentional kill is not auto-respawned", () => {
  const { pi, spawns } = makeManager();
  pi.ensure("s1", "/tmp/s1");

  const { info } = pi.spawnSubagent("s1", { name: "Worker" });
  assert.equal(spawns.length, 2);

  pi.killAgent("s1", info.id);
  // The killed process exits afterwards; the supervisor must not revive it.
  const killedChild = spawns[1].child;
  killedChild.crash();

  assert.equal(spawns.length, 2, "no respawn after an intentional kill");
  assert.equal(pi.hasAgent("s1", info.id), false);
});

test("session env is injected into Prime and inherited by sub-agents", () => {
  const { pi, spawns } = makeManager();
  pi.ensure("s1", "/tmp/s1", undefined, undefined, undefined, undefined, {
    TANGLE_ROOT_CONFIG: "annotations.project=p1",
  });

  assert.equal(
    spawns[0].env?.TANGLE_ROOT_CONFIG,
    "annotations.project=p1",
    "Prime's process env carries the session var",
  );

  pi.spawnSubagent("s1", { name: "Worker" });
  assert.equal(
    spawns[1].env?.TANGLE_ROOT_CONFIG,
    "annotations.project=p1",
    "a sub-agent inherits the same session var",
  );
});

test("{{workspacePath}} in session env expands to the session root", () => {
  const { pi, spawns } = makeManager();
  pi.ensure("s1", "/tmp/s1", undefined, undefined, undefined, undefined, {
    TANGLE_ROOT_CONFIG: "{{workspacePath}}/.tangle/root-config.yaml",
    PLAIN_VAR: "no placeholder here",
    UNKNOWN_TOKEN: "{{unknownToken}}/x",
  });

  assert.equal(
    spawns[0].env?.TANGLE_ROOT_CONFIG,
    "/tmp/s1/.tangle/root-config.yaml",
    "Prime's env resolves {{workspacePath}} to the session root",
  );
  assert.equal(
    spawns[0].env?.PLAIN_VAR,
    "no placeholder here",
    "a value without a placeholder is unchanged",
  );
  assert.equal(
    spawns[0].env?.UNKNOWN_TOKEN,
    "{{unknownToken}}/x",
    "an unknown placeholder is left verbatim",
  );

  pi.spawnSubagent("s1", { name: "Worker" });
  assert.equal(
    spawns[1].env?.TANGLE_ROOT_CONFIG,
    "/tmp/s1/.tangle/root-config.yaml",
    "a sub-agent inherits the same expanded value",
  );
});

test("session env cannot clobber reserved TANGENT_* keys", () => {
  const { pi, spawns } = makeManager();
  pi.ensure("s1", "/tmp/s1", undefined, undefined, undefined, undefined, {
    TANGENT_SESSION_ID: "evil",
    TANGENT_AGENT_ID: "evil",
    SAFE_VAR: "ok",
  });

  assert.equal(
    spawns[0].env?.TANGENT_SESSION_ID,
    "s1",
    "the reserved session id wins over a host-supplied one",
  );
  assert.equal(
    spawns[0].env?.TANGENT_AGENT_ID,
    PRIME_AGENT_ID,
    "the reserved agent id wins over a host-supplied one",
  );
  assert.equal(spawns[0].env?.SAFE_VAR, "ok", "non-reserved vars pass through");
});

test("session env cannot inject process-sensitive keys", () => {
  const { pi, spawns } = makeManager();
  pi.ensure("s1", "/tmp/s1", undefined, undefined, undefined, undefined, {
    NODE_OPTIONS: "--require=/evil.js",
    LD_PRELOAD: "/evil.so",
    PATH: "/evil/bin",
    TANGENT_AGENT_ROLE: "prime",
    TANGLE_ROOT_CONFIG: "annotations.project=p1",
  });

  assert.notEqual(
    spawns[0].env?.NODE_OPTIONS,
    "--require=/evil.js",
    "NODE_OPTIONS cannot be hijacked",
  );
  assert.equal(spawns[0].env?.LD_PRELOAD, undefined, "LD_PRELOAD is stripped");
  assert.notEqual(spawns[0].env?.PATH, "/evil/bin", "PATH cannot be hijacked");
  assert.equal(
    spawns[0].env?.TANGENT_AGENT_ROLE,
    "prime",
    "the reserved role wins over a host-supplied one",
  );
  assert.equal(
    spawns[0].env?.TANGLE_ROOT_CONFIG,
    "annotations.project=p1",
    "safe vars still pass through",
  );
});
