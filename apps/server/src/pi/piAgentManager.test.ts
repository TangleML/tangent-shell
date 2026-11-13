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

import type { MemoryResolver, MemorySpawnPlan } from "../memory/resolver.ts";
import type { AgentRole } from "../memory/types.ts";
import { RunRegistry } from "../runs/runRegistry.ts";
import { InMemoryRunStore } from "../store/inMemoryRunStore.ts";
import type { SessionAgent } from "../store/sessionStore.ts";
import type { ResolvedSessionConfig } from "./agentConfig.ts";
import {
  PiAgentManager,
  PRIME_AGENT_ID,
  SessionMaintenanceError,
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
}

/** A memory plan granting only `read_memory`, with overrides. */
function memoryPlan(overrides?: Partial<MemorySpawnPlan>): MemorySpawnPlan {
  return {
    env: {},
    extensionPaths: [],
    allowlistTools: ["read_memory"],
    deniedTools: [],
    ...overrides,
  };
}

/** A resolver whose every resolution projects `plan(role)` and a role-tagged
 * preamble. `plan` is re-read per resolution so a test can change it. */
function stubResolver(
  plan: (role: AgentRole) => MemorySpawnPlan = () => memoryPlan(),
): MemoryResolver {
  const resolution = () => {
    const current = plan;
    return {
      init: () => {},
      preamble: (role: AgentRole) => `## Memory\n\n(empty for ${role})`,
      spawnPlan: (role: AgentRole) => current(role),
    };
  };
  return {
    resolveDefault: resolution,
    resolve: async () => resolution(),
  } as unknown as MemoryResolver;
}

/** Builds a manager wired to a fake launcher; returns it plus the spawn log. */
function makeManager(options?: {
  shouldFailSpawn?: () => boolean;
  memory?: MemoryResolver;
}): {
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
      }),
    onSubagentUpdate: (_sessionId, subagent) =>
      rosterUpdates.push({ id: subagent.id, status: subagent.status }),
    onAgentMessage: () => {},
    onSessionStatus: () => {},
  };

  const memory = options?.memory ?? stubResolver();

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
async function withTempRoot(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-pi-manager-"));
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test("reviveSubagent re-spawns a sub-agent from its persisted config", async () => {
  const { pi, spawns } = makeManager();
  await pi.ensure("s1", "/tmp/s1");
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
  const revivedTools = revived.args[revived.args.indexOf("--tools") + 1];
  assert.ok(
    revivedTools.split(",").includes("read") &&
      revivedTools.split(",").includes("grep"),
    "revived process uses the persisted tool allowlist",
  );
  assert.ok(
    revivedTools.split(",").includes("read_memory"),
    "memory tools are granted dynamically at spawn, not from persisted tools",
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

test("reviveSubagent restores a detached row, and refuses Prime and terminal ones", async () => {
  const { pi, spawns } = makeManager();
  await pi.ensure("s1", "/tmp/s1");

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

test("reviveSubagent is idempotent and skips an already-live agent", async () => {
  const { pi, spawns } = makeManager();
  await pi.ensure("s1", "/tmp/s1");

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

test("ensure falls back when an installed bundle config cannot be reloaded", async () => {
  await withTempRoot(async (root) => {
    const { pi, spawns } = makeManager();
    const warn = mock.method(console, "warn", () => {});
    mkdirSync(path.join(root, ".tangent"));
    writeFileSync(
      path.join(root, ".tangent", "tangent.yaml"),
      "not: valid: yaml",
    );

    await assert.doesNotReject(pi.ensure("s1", root));

    assert.equal(spawns.length, 1, "ensure still spawns Prime");
    assert.ok(
      warn.mock.calls.some((call) =>
        String(call.arguments[0]).includes("failed to load installed bundle"),
      ),
      "expected corrupt bundle reload to be logged",
    );
  });
});

test("supervisor auto-respawns a crashed agent with backoff, then gives up", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { pi, spawns } = makeManager();
  await pi.ensure("s1", "/tmp/s1");
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

test("the local roster describes its connector", async () => {
  const { pi } = makeManager();
  await pi.ensure("s1", "/tmp/s1");
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

test("the appended system prompt is passed as a file, not an inline arg", async () => {
  const { pi, spawns } = makeManager();
  await pi.ensure("s1", "/tmp/s1");

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
    /## Memory\n\n\(empty for prime\)/,
    "the file holds the combined preamble",
  );

  pi.dispose("s1");
  assert.equal(existsSync(source), false, "dispose cleans up the prompt file");
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
  await h.pi.ensure("s1", "/tmp/s1");

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

test("a message delivered mid-run joins the run in flight", async () => {
  const h = makeManager();
  await h.pi.ensure("s1", "/tmp/s1");

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
  await h.pi.ensure("s1", "/tmp/s1");
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

test("aborting an idle agent refuses instead of cancelling nothing", async () => {
  const h = makeManager();
  await h.pi.ensure("s1", "/tmp/s1");

  assert.equal(h.pi.abort("s1", PRIME_AGENT_ID), false);
  assert.equal(h.pi.abort("s1", "ghost"), false);
});

test("a turn Pi starts on its own still gets a run", async () => {
  const h = makeManager();
  await h.pi.ensure("s1", "/tmp/s1");

  emitPi(h.spawns[0].child, { type: "agent_start" });

  assert.ok(h.runs.current("s1", PRIME_AGENT_ID));
});

test("a crash fails the run that was in flight", async () => {
  const h = makeManager();
  await h.pi.ensure("s1", "/tmp/s1");
  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "work" });
  const runId = h.runs.current("s1", PRIME_AGENT_ID)?.id;
  assert.ok(runId);

  h.spawns[0].child.crash();
  await flush();

  assert.equal((await h.runStore.getRun(runId))?.status, "failed");
});

test("a spawn alone opens no run; the task that follows does", async () => {
  const h = makeManager();
  await h.pi.ensure("s1", "/tmp/s1");

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
  await h.pi.ensure("s1", "/tmp/s1");
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

test("an intentional kill is not auto-respawned", async () => {
  const { pi, spawns } = makeManager();
  await pi.ensure("s1", "/tmp/s1");

  const { info } = pi.spawnSubagent("s1", { name: "Worker" });
  assert.equal(spawns.length, 2);

  pi.killAgent("s1", info.id);
  // The killed process exits afterwards; the supervisor must not revive it.
  const killedChild = spawns[1].child;
  killedChild.crash();

  assert.equal(spawns.length, 2, "no respawn after an intentional kill");
  assert.equal(pi.hasAgent("s1", info.id), false);
});

test("a synchronous spawn failure is relayed as an error, not thrown", async () => {
  const error = mock.method(console, "error", () => {});
  const { pi, spawns, events } = makeManager({ shouldFailSpawn: () => true });

  await assert.doesNotReject(pi.ensure("s1", "/tmp/s1"));
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

test("a supervisor respawn whose spawn fails does not throw out of the timer", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  mock.method(console, "error", () => {});
  let failSpawn = false;
  const { pi, spawns } = makeManager({ shouldFailSpawn: () => failSpawn });
  await pi.ensure("s1", "/tmp/s1");
  assert.equal(spawns.length, 1);

  // Crash the live process, then make the scheduled respawn's spawn fail.
  failSpawn = true;
  spawns[0].child.crash();
  assert.doesNotThrow(() => mock.timers.tick(1_000));

  assert.equal(spawns.length, 1, "the failed respawn registered no new child");
  assert.equal(pi.hasAgent("s1", PRIME_AGENT_ID), false);
});

test("session env is injected into Prime and inherited by sub-agents", async () => {
  const { pi, spawns } = makeManager();
  await pi.ensure("s1", "/tmp/s1", {
    env: {
      TANGLE_ROOT_CONFIG: "annotations.project=p1",
    },
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

test("{{workspacePath}} in session env expands to the session root", async () => {
  const { pi, spawns } = makeManager();
  await pi.ensure("s1", "/tmp/s1", {
    env: {
      TANGLE_ROOT_CONFIG: "{{workspacePath}}/.tangle/root-config.yaml",
      PLAIN_VAR: "no placeholder here",
      UNKNOWN_TOKEN: "{{unknownToken}}/x",
    },
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

test("session env cannot clobber reserved TANGENT_* keys", async () => {
  const { pi, spawns } = makeManager();
  await pi.ensure("s1", "/tmp/s1", {
    env: {
      TANGENT_SESSION_ID: "evil",
      TANGENT_AGENT_ID: "evil",
      SAFE_VAR: "ok",
    },
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

test("session env cannot inject process-sensitive keys", async () => {
  const { pi, spawns } = makeManager();
  await pi.ensure("s1", "/tmp/s1", {
    env: {
      NODE_OPTIONS: "--require=/evil.js",
      LD_PRELOAD: "/evil.so",
      PATH: "/evil/bin",
      TANGENT_AGENT_ROLE: "prime",
      TANGLE_ROOT_CONFIG: "annotations.project=p1",
    },
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

/** Reads the appended system prompt a spawn was given. */
function appendedPrompt(record: SpawnRecord): string {
  const flag = record.args.indexOf("--append-system-prompt");
  return readFileSync(record.args[flag + 1], "utf8");
}

test("concurrent ensure calls spawn Prime once", async () => {
  const { pi, spawns } = makeManager();
  await Promise.all([pi.ensure("s1", "/tmp/s1"), pi.ensure("s1", "/tmp/s1")]);
  assert.equal(spawns.length, 1);
});

test("dispose cancels an ensure still resolving memory", async () => {
  const { pi, spawns } = makeManager();
  const pending = pi.ensure("s1", "/tmp/s1");
  pi.dispose("s1");
  await pending;
  assert.equal(spawns.length, 0);
  assert.equal(pi.hasAgent("s1", PRIME_AGENT_ID), false);
});

test("every Prime spawn re-resolves memory instead of keeping the first", async () => {
  mock.method(console, "error", () => {});
  let failSpawn = true;
  let generation = "first";
  const memory = stubResolver(() =>
    memoryPlan({ env: { PI_MEMORY_DIR: `/mem/${generation}` } }),
  );
  const { pi, spawns } = makeManager({
    memory,
    shouldFailSpawn: () => failSpawn,
  });
  await pi.ensure("s1", "/tmp/s1");
  assert.equal(spawns.length, 0, "the first spawn failed");

  failSpawn = false;
  generation = "second";
  await pi.ensure("s1", "/tmp/s1");
  assert.equal(spawns[0].env?.PI_MEMORY_DIR, "/mem/second");
});

test("a sub-agent spawn drops the memory tools its role is denied", async () => {
  const memory = stubResolver((role) =>
    memoryPlan({
      deniedTools: role === "prime" ? [] : ["remember", "memory_write"],
    }),
  );
  const { pi, spawns } = makeManager({ memory });
  await pi.ensure("s1", "/tmp/s1");
  pi.spawnSubagent("s1", {
    name: "Worker",
    tools: ["read", "remember", "memory_write"],
  });

  const { args } = spawns[1];
  const tools = args[args.indexOf("--tools") + 1].split(",");
  assert.ok(tools.includes("read"));
  assert.ok(tools.includes("read_memory"));
  assert.equal(tools.includes("remember"), false);
  assert.equal(tools.includes("memory_write"), false);
});

test("memory env wins over inherited and session-supplied memory knobs", async (t) => {
  const inherited = {
    PI_MEMORY_EXIT_SUMMARY: "0",
    PI_MEMORY_SUMMARIZE_TRANSITIONS: "1",
  };
  Object.assign(process.env, inherited);
  t.after(() => {
    for (const key of Object.keys(inherited)) delete process.env[key];
  });
  const memory = stubResolver(() =>
    memoryPlan({
      env: {
        PI_MEMORY_DIR: "/mem",
        PI_MEMORY_EXIT_SUMMARY: "1",
        INDEX_PATH: "/mem-qmd/index.sqlite",
      },
    }),
  );
  const { pi, spawns } = makeManager({ memory });
  await pi.ensure("s1", "/tmp/s1", {
    env: {
      PI_MEMORY_NO_SEARCH: "1",
      INDEX_PATH: "/elsewhere/index.sqlite",
      SAFE_VAR: "ok",
    },
  });

  const env = spawns[0].env ?? {};
  assert.equal(env.PI_MEMORY_EXIT_SUMMARY, "1");
  assert.equal(env.PI_MEMORY_DIR, "/mem");
  assert.equal(env.PI_MEMORY_SUMMARIZE_TRANSITIONS, undefined);
  assert.equal(env.PI_MEMORY_NO_SEARCH, undefined);
  assert.equal(env.INDEX_PATH, "/mem-qmd/index.sqlite");
  assert.equal(env.SAFE_VAR, "ok");
});

test("each agent's preamble is rendered for its own role", async () => {
  const { pi, spawns } = makeManager();
  await pi.ensure("s1", "/tmp/s1");
  pi.spawnSubagent("s1", { name: "Worker" });

  assert.match(appendedPrompt(spawns[0]), /\(empty for prime\)/);
  assert.match(appendedPrompt(spawns[1]), /\(empty for subagent\)/);
});

test("memoryCaller hands live agents Prime's resolution and their own role", async () => {
  const { pi } = makeManager();
  await pi.ensure("s1", "/tmp/s1");
  const { info } = pi.spawnSubagent("s1", { name: "Worker" });

  const prime = pi.memoryCaller("s1", PRIME_AGENT_ID);
  const sub = pi.memoryCaller("s1", info.id);
  assert.equal(prime?.role, "prime");
  assert.equal(sub?.role, "subagent");
  assert.ok(prime?.memory);
  assert.equal(sub?.memory, prime?.memory, "one resolution per Prime spawn");
  assert.equal(pi.memoryCaller("s1", "ghost"), undefined);

  pi.dispose("s1");
  assert.equal(pi.memoryCaller("s1", PRIME_AGENT_ID), undefined);
});

/** The prompt messages a fake Pi child received on stdin, in order. */
function promptsOf(child: FakeChild): string[] {
  return child.writes
    .map((line) => JSON.parse(line) as { type?: string; message?: string })
    .filter((command) => command.type === "prompt")
    .map((command) => command.message ?? "");
}

const RESTART_NOTICE_PREFIX = "[Tangent: your process was restarted";

test("a fresh session's Prime gets no restart notice", async () => {
  const { pi, spawns } = makeManager();
  pi.useTranscript(async () => false);
  await pi.ensure("s1", "/tmp/s1");

  pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "hello" });

  assert.deepEqual(promptsOf(spawns[0].child), ["hello"]);
});

test("a Prime spawned onto an existing transcript is told once to recover", async () => {
  const { pi, spawns } = makeManager();
  pi.useTranscript(async () => true);
  await pi.ensure("s1", "/tmp/s1");

  pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "first" });
  runTurn(spawns[0].child, "done");
  await flush();
  pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "second" });

  const [first, second] = promptsOf(spawns[0].child);
  assert.ok(first.startsWith(RESTART_NOTICE_PREFIX));
  assert.ok(first.endsWith("\n\nfirst"));
  assert.equal(second, "second");
});

test("a crashed Prime's replacement is told to recover", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { pi, spawns } = makeManager();
  await pi.ensure("s1", "/tmp/s1");
  pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "hello" });

  spawns[0].child.crash();
  mock.timers.tick(1_000);
  pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "again" });

  const [prompt] = promptsOf(spawns[1].child);
  assert.ok(prompt.startsWith(RESTART_NOTICE_PREFIX));
});

test("a model change that respawns Prime mid-session tells it to recover", async () => {
  const { pi, spawns } = makeManager();
  await pi.ensure("s1", "/tmp/s1");
  pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "hello" });

  pi.setAgentModel("s1", PRIME_AGENT_ID, { thinkingDepth: "high" });
  pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "again" });

  const [prompt] = promptsOf(spawns[1].child);
  assert.ok(prompt.startsWith(RESTART_NOTICE_PREFIX));
});

test("a failing transcript lookup spawns Prime without the notice", async () => {
  const { pi, spawns } = makeManager();
  pi.useTranscript(async () => {
    throw new Error("store unavailable");
  });
  await pi.ensure("s1", "/tmp/s1");

  pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "hello" });

  assert.deepEqual(promptsOf(spawns[0].child), ["hello"]);
});

/** A bundle config with one Prime prompt and the given sub-agent templates. */
function bundleConfig(
  primePrompt: string,
  templates: Record<string, string>,
): ResolvedSessionConfig {
  return {
    prime: {
      tools: ["read"],
      appendSystemPrompt: primePrompt,
      model: "proxy/bundle-model",
    },
    subagentDefaults: {},
    templates: new Map(
      Object.entries(templates).map(([name, systemPrompt]) => [
        name,
        { name, description: name, tools: ["read"], systemPrompt },
      ]),
    ),
    skillPaths: [],
    workflowPaths: [],
    extensionPaths: [],
  };
}

test("reloadSession respawns Prime and live sub-agents with the new bundle", async () => {
  const h = makeManager();
  const v1 = bundleConfig("prime v1", { scout: "scout v1", gone: "gone v1" });
  await h.pi.ensure("s1", "/tmp/s1", { config: v1 });
  const scout = h.pi.spawnSubagent("s1", { name: "Scout", template: "scout" });
  const gone = h.pi.spawnSubagent("s1", { name: "Old", template: "gone" });
  const inline = h.pi.spawnSubagent("s1", {
    name: "Inline",
    systemPrompt: "inline prompt",
  });
  h.pi.setAgentModel("s1", PRIME_AGENT_ID, { model: "proxy/user-pick" });
  const before = h.spawns.length;

  const reload = h.pi.reloadSession(
    "s1",
    bundleConfig("prime v2", { scout: "scout v2" }),
  );

  assert.equal(reload.primeRestarted, true);
  assert.deepEqual(
    reload.respawned.map((agent) => agent.info.id).sort(),
    [scout.info.id, inline.info.id].sort(),
  );
  assert.deepEqual(reload.stopped, [
    { id: gone.info.id, name: "Old", template: "gone" },
  ]);
  const fresh = h.spawns.slice(before);
  assert.equal(fresh.length, 3, "Prime, the scout and the inline agent");
  const byId = (id: string) => fresh.find((spawn) => spawn.agentId === id)!;
  assert.match(appendedPrompt(byId(PRIME_AGENT_ID)), /prime v2/);
  assert.match(appendedPrompt(byId(scout.info.id)), /scout v2/);
  assert.match(appendedPrompt(byId(inline.info.id)), /inline prompt/);
  assert.equal(
    h.pi.getAgentSelection("s1", PRIME_AGENT_ID)?.model,
    "proxy/user-pick",
    "a user model override survives the reload",
  );
  assert.equal(h.pi.hasAgent("s1", gone.info.id), false);
  assert.ok(
    h.rosterUpdates.some((u) => u.id === gone.info.id && u.status === "killed"),
  );
});

test("reloadSession cancels a run it cuts instead of leaving it open", async () => {
  const h = makeManager();
  await h.pi.ensure("s1", "/tmp/s1", { config: bundleConfig("v1", {}) });
  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "go" });
  const runId = h.runs.current("s1", PRIME_AGENT_ID)?.id;
  assert.ok(runId);
  assert.equal(h.pi.isBusy("s1"), true, "a mid-run session reads busy");

  h.pi.reloadSession("s1", bundleConfig("v2", {}));
  await flush();

  assert.equal((await h.runStore.getRun(runId))?.status, "cancelled");
  assert.equal(h.pi.isBusy("s1"), false);
});

test("a Prime restarted by a bundle reload is told to recover its context", async () => {
  const h = makeManager();
  await h.pi.ensure("s1", "/tmp/s1", { config: bundleConfig("v1", {}) });
  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "hi" });
  runTurn(h.spawns[0].child, "hello");
  await flush();

  h.pi.reloadSession("s1", bundleConfig("v2", {}));
  const restarted = h.spawns.at(-1)!;
  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "next" });

  const [prompt] = promptsOf(restarted.child);
  assert.ok(prompt.startsWith(RESTART_NOTICE_PREFIX));
  assert.ok(prompt.endsWith("\n\nnext"));
});

test("a prompt that arrives during a bundle reload reaches the replacement Prime", async () => {
  const h = makeManager();
  await h.pi.ensure("s1", "/tmp/s1", { config: bundleConfig("v1", {}) });
  const old = h.spawns[0];

  assert.equal(h.pi.beginMaintenance("s1"), true);
  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "mid" });
  assert.deepEqual(promptsOf(old.child), [], "held, not sent to the old Prime");
  assert.equal(h.runs.current("s1", PRIME_AGENT_ID), undefined);
  assert.throws(
    () => h.pi.spawnSubagent("s1", { name: "Late" }),
    SessionMaintenanceError,
  );

  h.pi.reloadSession("s1", bundleConfig("v2", {}));
  h.pi.endMaintenance("s1");

  const replacement = h.spawns.at(-1)!;
  assert.notEqual(replacement, old);
  assert.deepEqual(promptsOf(replacement.child), ["mid"]);
  assert.ok(
    h.runs.current("s1", PRIME_AGENT_ID),
    "the replayed prompt opens a run",
  );
});

test("maintenance is only claimed while idle, and a waiting ensure resumes after it", async () => {
  const h = makeManager();
  await h.pi.ensure("s1", "/tmp/s1", { config: bundleConfig("v1", {}) });
  h.pi.sendToAgent({ sessionId: "s1", agentId: PRIME_AGENT_ID, text: "go" });
  assert.equal(
    h.pi.beginMaintenance("s1"),
    false,
    "a mid-run session is refused",
  );
  runTurn(h.spawns[0].child, "done");
  await flush();

  assert.equal(h.pi.beginMaintenance("s1"), true);
  assert.equal(h.pi.beginMaintenance("s1"), false, "one window at a time");
  h.pi.dispose("s1");
  assert.equal(
    h.pi.beginMaintenance("s1"),
    true,
    "dispose released the window",
  );
  h.pi.endMaintenance("s1");

  assert.equal(h.pi.beginMaintenance("s2"), true);
  let spawnedDuring = false;
  const pending = h.pi.ensure("s2", "/tmp/s2").then(() => {
    spawnedDuring = h.pi.hasAgent("s2", PRIME_AGENT_ID);
  });
  await flush();
  assert.equal(
    h.pi.hasAgent("s2", PRIME_AGENT_ID),
    false,
    "Prime waits out the swap",
  );
  h.pi.endMaintenance("s2");
  await pending;
  assert.equal(spawnedDuring, true);
});
