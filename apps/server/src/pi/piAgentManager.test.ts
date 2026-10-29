import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
import {
  PiAgentManager,
  PRIME_AGENT_ID,
  type SendToAgentOptions,
} from "./piAgentManager.ts";
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

/** An `E2BIG`-shaped error, matching Node's synchronous `spawn` failure. */
function e2bigError(): NodeJS.ErrnoException {
  const err = new Error("spawn E2BIG") as NodeJS.ErrnoException;
  err.errno = -7;
  err.code = "E2BIG";
  err.syscall = "spawn";
  return err;
}

/** Logs a successful fake spawn and returns its child. */
function recordSpawn(
  spawns: SpawnRecord[],
  args: string[],
  env: NodeJS.ProcessEnv | undefined,
): ChildProcessWithoutNullStreams {
  const child = new FakeChild();
  spawns.push({ args, agentId: env?.TANGENT_AGENT_ID, env, child });
  return child as unknown as ChildProcessWithoutNullStreams;
}

/** One relayed agent event, reduced to what the run tests assert on. */
interface RelayedEvent {
  agentId: string;
  type: string;
  runId?: string;
  actingTeam?: string;
}

/** Builds a manager wired to a fake launcher; returns it plus the spawn log. */
function makeManager(options?: { shouldFailSpawn?: () => boolean }): {
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
    spawnOptions: { env?: NodeJS.ProcessEnv },
  ) => {
    if (options?.shouldFailSpawn?.()) throw e2bigError();
    return recordSpawn(spawns, args, spawnOptions?.env);
  }) as unknown as typeof spawn;

  const handlers: ConversationEventSink = {
    onAgentEvent: (_sessionId, agent, event) =>
      events.push({
        agentId: agent.agentId,
        type: event.type,
        runId: event.runId,
        actingTeam: event.actingTeam,
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

test("the appended system prompt is passed as a file, not an inline arg", () => {
  const { pi, spawns } = makeManager();
  pi.ensure("s1", "/tmp/s1");

  const { args } = spawns[0];
  const flag = args.indexOf("--append-system-prompt");
  assert.notEqual(flag, -1, "the spawn passes an appended system prompt");
  const source = args[flag + 1];

  assert.ok(
    !source.includes("## Memory"),
    "the argument is a file path, not the inline prompt text",
  );
  assert.ok(existsSync(source), "the prompt file exists at spawn time");
  assert.match(
    readFileSync(source, "utf8"),
    /## Memory\n\n\(empty\)/,
    "the file holds the combined preamble",
  );

  pi.dispose("s1");
  assert.equal(existsSync(source), false, "dispose cleans up the prompt file");
});

/** Feeds one Pi stdout event into an agent's reader. */
function emitPi(child: FakeChild, event: Record<string, unknown>): void {
  child.stdout.emit("data", Buffer.from(`${JSON.stringify(event)}\n`));
}

/** The RPC commands written to an agent's stdin, oldest first. */
function commands(
  child: FakeChild,
): { id: string; type: string; streamingBehavior?: string }[] {
  return child.writes.map((line) => JSON.parse(line));
}

/** The ids of the prompts written to an agent's stdin, oldest first. */
function promptIds(child: FakeChild): string[] {
  return commands(child)
    .filter((command) => command.type === "prompt")
    .map((command) => command.id);
}

/** Answers a prompt as Pi does, by default the last one written. */
function answer(
  child: FakeChild,
  disposition: "started" | "queued" | "handled",
  id = promptIds(child).at(-1),
): void {
  emitPi(child, {
    type: "response",
    id,
    command: "prompt",
    success: true,
    data: { disposition },
  });
}

/** Starts Pi's run for the last prompt written. */
function startTurn(child: FakeChild): void {
  answer(child, "started");
  emitPi(child, { type: "agent_start" });
}

/** Drives a full Pi run for the last prompt: one assistant message, from its
 * `started` answer to `agent_settled`. */
function runTurn(child: FakeChild, text: string): void {
  startTurn(child);
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
  emitPi(child, { type: "agent_settled", aborted: false });
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

/** Reports Pi's pending queues, as Pi does whenever one changes. */
function queueUpdate(
  child: FakeChild,
  queues: { steering?: string[]; followUp?: string[] },
): void {
  emitPi(child, {
    type: "queue_update",
    steering: queues.steering ?? [],
    followUp: queues.followUp ?? [],
  });
}

/** The team Prime's open Run acts as. */
function primeTeam(h: ReturnType<typeof makeManager>): string | undefined {
  return h.runs.actingTeamFor("s1", PRIME_AGENT_ID);
}

/** Sends Prime a message in session `s1`. */
function sendPrime(
  h: ReturnType<typeof makeManager>,
  text: string,
  options: Partial<SendToAgentOptions> = {},
): void {
  h.pi.sendToAgent({
    sessionId: "s1",
    agentId: PRIME_AGENT_ID,
    text,
    ...options,
  });
}

/** Sends follow-ups mid-run, answering each as Pi does when it queues one. */
function sendFollowUps(
  h: ReturnType<typeof makeManager>,
  child: FakeChild,
  prompts: [text: string, actingTeam: string | undefined][],
): void {
  const followUp: string[] = [];
  for (const [text, actingTeam] of prompts) {
    sendPrime(h, text, { actingTeam });
    followUp.push(text);
    queueUpdate(child, { followUp });
    answer(child, "queued");
  }
}

test("a prompt's team rides on the run it opens and on that run's events", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");

  h.pi.sendToAgent({
    sessionId: "s1",
    agentId: PRIME_AGENT_ID,
    text: "submit it",
    actingTeam: "team-a",
  });
  assert.equal(primeTeam(h), "team-a");

  runTurn(h.spawns[0].child, "done");
  const end = h.events.find((e) => e.type === "end");
  assert.equal(end?.actingTeam, "team-a");
  assert.equal(primeTeam(h), undefined, "the team ends with its run");

  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "again" });
  assert.equal(primeTeam(h), undefined, "a later prompt inherits nothing");
});

test("a steer from another team narrows the run in flight to no team", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;
  h.pi.sendToAgent({
    sessionId: "s1",
    agentId: PRIME_AGENT_ID,
    text: "work",
    actingTeam: "team-a",
  });
  startTurn(child);

  h.pi.sendToAgent({
    sessionId: "s1",
    agentId: PRIME_AGENT_ID,
    text: "also",
    delivery: "steer",
    actingTeam: "team-b",
  });
  queueUpdate(child, { steering: ["also"] });
  answer(child, "queued");
  assert.equal(primeTeam(h), "team-a", "a queued steer changes nothing yet");

  queueUpdate(child, {});
  assert.equal(primeTeam(h), undefined);
});

test("a steer under the same team keeps it", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;
  h.pi.sendToAgent({
    sessionId: "s1",
    agentId: PRIME_AGENT_ID,
    text: "work",
    actingTeam: "team-a",
  });
  startTurn(child);

  h.pi.sendToAgent({
    sessionId: "s1",
    agentId: PRIME_AGENT_ID,
    text: "also",
    delivery: "steer",
    actingTeam: "team-a",
  });
  queueUpdate(child, { steering: ["also"] });
  answer(child, "queued");
  queueUpdate(child, {});

  assert.equal(primeTeam(h), "team-a");
});

test("a follow-up takes over the run as its own team", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;
  h.pi.sendToAgent({
    sessionId: "s1",
    agentId: PRIME_AGENT_ID,
    text: "work",
  });
  startTurn(child);

  h.pi.sendToAgent({
    sessionId: "s1",
    agentId: PRIME_AGENT_ID,
    text: "next",
    actingTeam: "team-b",
  });
  queueUpdate(child, { followUp: ["next"] });
  answer(child, "queued");
  assert.equal(primeTeam(h), undefined, "the first scope runs as its own");

  queueUpdate(child, {});
  assert.equal(primeTeam(h), "team-b");
});

test("follow-ups drained together keep a team only if they all share it", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;
  h.pi.sendToAgent({
    sessionId: "s1",
    agentId: PRIME_AGENT_ID,
    text: "work",
    actingTeam: "team-a",
  });
  startTurn(child);

  sendFollowUps(h, child, [
    ["one", "team-b"],
    ["two", "team-c"],
  ]);
  queueUpdate(child, {});

  assert.equal(primeTeam(h), undefined);
});

test("follow-ups drained one at a time each take over in turn", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;
  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "work" });
  startTurn(child);

  sendFollowUps(h, child, [
    ["one", "team-b"],
    ["two", "team-c"],
  ]);
  queueUpdate(child, { followUp: ["two"] });
  assert.equal(primeTeam(h), "team-b");

  emitPi(child, { type: "message_start", message: { role: "assistant" } });
  queueUpdate(child, {});
  assert.equal(primeTeam(h), "team-c");
});

test("every prompt tells Pi how to queue it, even one that finds the agent idle", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;

  sendPrime(h, "work");
  startTurn(child);
  sendPrime(h, "also", { delivery: "steer" });

  assert.deepEqual(
    commands(child).map((command) => command.streamingBehavior),
    ["followUp", "steer"],
  );
});

test("a prompt Pi handles mid-run doesn't shift a later follow-up onto its team", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;
  sendPrime(h, "work", { actingTeam: "team-a" });
  startTurn(child);

  sendPrime(h, "/ext-command", { actingTeam: "team-a" });
  answer(child, "handled");
  sendFollowUps(h, child, [["non-member follow-up", undefined]]);
  queueUpdate(child, {});

  assert.equal(primeTeam(h), undefined);
});

test("a prompt Pi starts after its run settles opens its own Run", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;
  sendPrime(h, "work");
  startTurn(child);

  sendPrime(h, "non-member late");
  const [, late] = promptIds(child);
  emitPi(child, { type: "agent_end" });
  emitPi(child, { type: "agent_settled", aborted: false });
  sendPrime(h, "held relay", { actingTeam: "team-a" });
  answer(child, "started", late);
  emitPi(child, { type: "agent_start" });
  assert.equal(primeTeam(h), undefined, "the late prompt's turn has no team");

  queueUpdate(child, { followUp: ["held relay"] });
  answer(child, "queued");
  queueUpdate(child, {});
  assert.equal(primeTeam(h), "team-a", "the relay's team waits for its turn");
});

test("a follow-up queued as a turn ends joins the Run, which lasts until Pi settles", async () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;
  sendPrime(h, "work");
  startTurn(child);
  const runId = h.runs.current("s1", PRIME_AGENT_ID)?.id;

  sendFollowUps(h, child, [["non-member late", undefined]]);
  emitPi(child, { type: "agent_end" });
  sendPrime(h, "held relay", { actingTeam: "team-a" });
  queueUpdate(child, { followUp: ["non-member late", "held relay"] });
  answer(child, "queued");
  emitPi(child, { type: "agent_start" });
  queueUpdate(child, { followUp: ["held relay"] });
  assert.equal(h.runs.current("s1", PRIME_AGENT_ID)?.id, runId);
  assert.equal(primeTeam(h), undefined);

  emitPi(child, { type: "message_start", message: { role: "assistant" } });
  queueUpdate(child, {});
  assert.equal(primeTeam(h), "team-a");

  emitPi(child, { type: "agent_end" });
  emitPi(child, { type: "agent_settled", aborted: false });
  await flush();
  assert.equal((await h.runStore.getRun(runId ?? ""))?.status, "completed");
});

test("an idle prompt Pi handles settles its Run and frees the agent", async () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  sendPrime(h, "/ext-command");
  const runId = h.runs.current("s1", PRIME_AGENT_ID)?.id;
  assert.ok(runId);

  answer(h.spawns[0].child, "handled");
  await flush();

  assert.equal(h.runs.current("s1", PRIME_AGENT_ID), undefined);
  assert.equal((await h.runStore.getRun(runId))?.status, "completed");
  assert.equal(h.pi.abort("s1", PRIME_AGENT_ID), false, "the agent is idle");
});

test("a prompt Pi rejects fails the Run it opened", async () => {
  mock.method(console, "error", () => {});
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;
  sendPrime(h, "work");
  const runId = h.runs.current("s1", PRIME_AGENT_ID)?.id;
  assert.ok(runId);

  emitPi(child, {
    type: "response",
    id: promptIds(child)[0],
    command: "prompt",
    success: false,
    error: "No API key found",
  });
  await flush();

  assert.equal((await h.runStore.getRun(runId))?.status, "failed");
  assert.equal(h.pi.abort("s1", PRIME_AGENT_ID), false, "the agent is idle");
});

test("a queued answer that trails its drain still applies the prompt's team", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;
  sendPrime(h, "work");
  startTurn(child);

  sendPrime(h, "next", { actingTeam: "team-b" });
  queueUpdate(child, { followUp: ["next"] });
  queueUpdate(child, {});
  answer(child, "queued");

  assert.equal(primeTeam(h), "team-b");
});

test("a retry stays in the Run and keeps its team", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;
  sendPrime(h, "work", { actingTeam: "team-a" });
  startTurn(child);
  const runId = h.runs.current("s1", PRIME_AGENT_ID)?.id;

  emitPi(child, { type: "agent_end" });
  emitPi(child, { type: "agent_start" });

  assert.equal(h.runs.current("s1", PRIME_AGENT_ID)?.id, runId);
  assert.equal(primeTeam(h), "team-a");
});

test("a turn that starts before Pi answers a prompt isn't that prompt's", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;
  sendPrime(h, "work", { actingTeam: "team-a" });
  const provisional = h.runs.current("s1", PRIME_AGENT_ID)?.id;

  emitPi(child, { type: "agent_start" });
  assert.notEqual(h.runs.current("s1", PRIME_AGENT_ID)?.id, provisional);
  assert.equal(primeTeam(h), undefined);

  queueUpdate(child, { followUp: ["work"] });
  answer(child, "queued");
  queueUpdate(child, {});
  assert.equal(primeTeam(h), "team-a");
});

test("a prompt Pi queues behind a run the manager missed acts as no team until it drains", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;
  sendPrime(h, "work", { actingTeam: "team-a" });

  queueUpdate(child, { followUp: ["work"] });
  answer(child, "queued");
  assert.equal(primeTeam(h), undefined);

  queueUpdate(child, {});
  assert.equal(primeTeam(h), "team-a");
});

test("aborting clears Pi's queue so nothing in it is read as drained", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;
  sendPrime(h, "work", { actingTeam: "team-a" });
  startTurn(child);
  sendFollowUps(h, child, [["next", "team-b"]]);

  h.pi.abort("s1", PRIME_AGENT_ID);
  queueUpdate(child, {});

  assert.deepEqual(
    commands(child)
      .slice(-2)
      .map((command) => command.type),
    ["clear_queue", "abort"],
  );
  assert.equal(primeTeam(h), "team-a");
});

test("a prompt sent while an abort lands waits for Pi to settle", async () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;
  sendPrime(h, "work");
  startTurn(child);
  const runId = h.runs.current("s1", PRIME_AGENT_ID)?.id;
  assert.ok(runId);

  h.pi.abort("s1", PRIME_AGENT_ID);
  sendPrime(h, "after", { actingTeam: "team-b" });
  assert.equal(promptIds(child).length, 1, "the prompt is held");

  emitPi(child, { type: "agent_end" });
  emitPi(child, { type: "agent_settled", aborted: true });
  emitPi(child, { type: "response", command: "abort", success: true });
  await flush();

  assert.equal((await h.runStore.getRun(runId))?.status, "cancelled");
  assert.equal(promptIds(child).length, 2, "the prompt is written once");
  assert.equal(primeTeam(h), "team-b", "and opens its own Run");
});

test("a prompt held during an abort that found no run is written on its answer", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const child = h.spawns[0].child;
  sendPrime(h, "/ext-command");
  const [command] = promptIds(child);

  h.pi.abort("s1", PRIME_AGENT_ID);
  sendPrime(h, "after", { actingTeam: "team-b" });
  answer(child, "handled", command);
  assert.equal(promptIds(child).length, 1);

  emitPi(child, { type: "response", command: "abort", success: true });
  assert.equal(promptIds(child).length, 2);
  assert.equal(primeTeam(h), "team-b");
});

test("the server alone keeps TANGLE_TOKEN; each agent gets its own token", (t) => {
  const previous = process.env.TANGLE_TOKEN;
  process.env.TANGLE_TOKEN = "SESSION=secret";
  t.after(() => {
    if (previous === undefined) delete process.env.TANGLE_TOKEN;
    else process.env.TANGLE_TOKEN = previous;
  });
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  h.pi.spawnSubagent("s1", { name: "Worker" });

  const [prime, sub] = h.spawns.map((s) => s.env ?? {});
  assert.equal(prime.TANGLE_TOKEN, undefined);
  assert.equal(sub.TANGLE_TOKEN, undefined);
  assert.ok(prime.TANGENT_AGENT_TOKEN);
  assert.notEqual(prime.TANGENT_AGENT_TOKEN, sub.TANGENT_AGENT_TOKEN);
});

test("an agent token resolves to its live agent and nothing else", () => {
  const h = makeManager();
  h.pi.ensure("s1", "/tmp/s1");
  const { info } = h.pi.spawnSubagent("s1", { name: "Worker" });
  const [primeToken, subToken] = h.spawns.map(
    (s) => s.env?.TANGENT_AGENT_TOKEN,
  );

  assert.deepEqual(h.pi.agentForToken(primeToken), {
    sessionId: "s1",
    agentId: PRIME_AGENT_ID,
  });
  assert.deepEqual(h.pi.agentForToken(subToken), {
    sessionId: "s1",
    agentId: info.id,
  });
  assert.equal(h.pi.agentForToken("forged"), undefined);
  assert.equal(h.pi.agentForToken(undefined), undefined);

  h.pi.killAgent("s1", info.id);
  assert.equal(h.pi.agentForToken(subToken), undefined);
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
  startTurn(h.spawns[0].child);

  assert.equal(h.pi.abort("s1", PRIME_AGENT_ID), true);
  emitPi(h.spawns[0].child, { type: "agent_end" });
  emitPi(h.spawns[0].child, { type: "agent_settled", aborted: true });
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

test("a synchronous spawn failure is relayed as an error, not thrown", () => {
  const error = mock.method(console, "error", () => {});
  const { pi, spawns, events } = makeManager({ shouldFailSpawn: () => true });

  assert.doesNotThrow(() => pi.ensure("s1", "/tmp/s1"));
  assert.equal(spawns.length, 0, "a failed spawn registers no child");
  assert.equal(
    pi.hasAgent("s1", PRIME_AGENT_ID),
    false,
    "the agent is not added to the roster",
  );
  assert.deepEqual(
    events.filter((e) => e.type === "error").map((e) => e.agentId),
    [PRIME_AGENT_ID],
    "the failure is relayed as one error event for the agent",
  );
  assert.ok(error.mock.calls.length > 0, "the failure is logged");
});

test("a supervisor respawn whose spawn fails does not throw out of the timer", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  mock.method(console, "error", () => {});
  let failSpawn = false;
  const { pi, spawns } = makeManager({ shouldFailSpawn: () => failSpawn });
  pi.ensure("s1", "/tmp/s1");
  assert.equal(spawns.length, 1);

  // Crash the live process, then make the scheduled respawn's spawn fail.
  failSpawn = true;
  spawns[0].child.crash();
  assert.doesNotThrow(() => mock.timers.tick(1_000));

  assert.equal(spawns.length, 1, "the failed respawn registered no new child");
  assert.equal(pi.hasAgent("s1", PRIME_AGENT_ID), false);
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
