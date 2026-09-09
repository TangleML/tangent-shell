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
  const pi = new PiAgentManager(handlers, memory, runs, fakeSpawn);
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
  assert.equal(info.host, "local");
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
    ["activity", "start", "activity", "delta", "end", "activity", "activity"],
  );
  assert.ok(
    relayed.every((e) => e.runId === runId),
    "every event of the turn is attributed to the one run",
  );
  assert.equal((await h.runStore.getRun(runId))?.status, "completed");
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
