import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { SubagentStatus } from "@tangent/shared/contracts.ts";
import { SocketEvents } from "@tangent/shared/contracts.ts";
import type { Server } from "socket.io";

import type { ConversationRouter } from "../../conversation/conversationRouter.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import type { PiAgentManager, PrimeSpawnOptions } from "../piAgentManager.ts";
import { TriggerEngine } from "./triggerEngine.ts";
import { retirementReason, type TargetState } from "./triggerLifecycle.ts";
import { type StoredTrigger, TriggerManager } from "./triggerManager.ts";

const SESSION_ENV = { STUDIO_ENGINE_URL: "http://127.0.0.1:8100" };

function engineFor(target: StoredTrigger["target"]) {
  const ensured: PrimeSpawnOptions[] = [];
  const stored = {
    id: "t1",
    name: "engine-step",
    kind: "callback",
    enabled: true,
    prompt: "{{body.prompt}}",
    target,
  } as unknown as StoredTrigger;
  const store = {
    listAgents: async () => [],
    getSessionEnv: async () => SESSION_ENV,
    recordAgent: async () => undefined,
  } as unknown as SessionStore;
  const pi = {
    ensure: async (_id: string, _root: string, options: PrimeSpawnOptions) => {
      ensured.push(options);
    },
    hasAgent: () => true,
  } as unknown as PiAgentManager;
  const triggers = {
    getStored: () => stored,
    markFired: () => undefined,
    get: () => undefined,
  } as unknown as TriggerManager;
  const conversations = {
    post: async () => undefined,
  } as unknown as ConversationRouter;
  const engine = new TriggerEngine(
    {} as Server,
    store,
    pi,
    triggers,
    conversations,
  );
  return { engine, ensured };
}

test("a Prime-target firing revives Prime with the session's env", async () => {
  const { engine, ensured } = engineFor({ type: "prime" });
  await engine.fire("s1", "/tmp/s1", "t1", { body: { prompt: "go" } });
  assert.deepEqual(ensured[0]?.env, SESSION_ENV);
});

test("a sub-agent-target firing revives Prime with the session's env", async () => {
  const { engine, ensured } = engineFor({
    type: "subagent",
    agentId: "a1",
    spec: { name: "worker" },
  } as StoredTrigger["target"]);
  await engine.fire("s1", "/tmp/s1", "t1", { body: { prompt: "go" } });
  assert.deepEqual(ensured[0]?.env, SESSION_ENV);
});

// --- Trigger lifetimes: expiry, fire budgets, dead targets, skips, wake ---

/** A sub-agent roster row as the store returns it. */
interface AgentRow {
  id: string;
  role: "subagent";
  status: SubagentStatus;
  capabilities: string[];
}

/**
 * A real {@link TriggerManager} over a temp dir, driven by an engine whose
 * store, Pi manager, router and socket server are recording fakes.
 */
function lifecycleHarness() {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-trigger-life-"));
  roots.push(root);
  const rows: AgentRow[] = [];
  const live = new Set<string>();
  const posts: { content: string; mentions?: string[] }[] = [];
  const spawned: string[] = [];
  const emitted: string[] = [];
  let release: (() => void) | undefined;
  let hold = false;
  let markParked: () => void = () => {};
  const parked = new Promise<void>((resolve) => (markParked = resolve));

  const store = {
    listAgents: async () => rows,
    getSessionEnv: async () => ({}),
    recordAgent: async () => undefined,
    setAgentStatus: async (_s: string, id: string, status: SubagentStatus) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (row) row.status = status;
    },
  } as unknown as SessionStore;
  const pi = {
    ensure: async () => undefined,
    hasAgent: (_s: string, id: string) => live.has(id),
    spawnSubagent: (_s: string, request: { name: string }) => {
      const id = `spawned-${spawned.length + 1}`;
      spawned.push(request.name);
      live.add(id);
      return {
        info: { id, name: request.name },
        tools: [],
        systemPrompt: "",
        autoRelayToPrime: false,
      };
    },
  } as unknown as PiAgentManager;
  const conversations = {
    post: async (posted: { content: string; mentions?: string[] }) => {
      if (hold) {
        await new Promise<void>((resolve) => {
          release = resolve;
          markParked();
        });
      }
      posts.push(posted);
    },
  } as unknown as ConversationRouter;
  const io = {
    to: () => ({ emit: (event: string) => emitted.push(event) }),
  } as unknown as Server;

  const triggers = new TriggerManager();
  const engine = new TriggerEngine(io, store, pi, triggers, conversations);
  engines.push(engine);

  /** A runtime trigger served by sub-agent `agentId` (provisioned, live). */
  function watcher(
    extra: Partial<Parameters<TriggerManager["create"]>[2]> = {},
    agentId = "w1",
  ) {
    const created = triggers.create("s1", root, {
      name: extra.name ?? "watch",
      kind: "schedule",
      prompt: "check",
      schedule: { every: "1h" },
      ...extra,
    });
    triggers.setTargetAgent("s1", created.id, agentId, "watcher");
    rows.push({
      id: agentId,
      role: "subagent",
      status: "active",
      capabilities: [],
    });
    live.add(agentId);
    return created.id;
  }

  return {
    root,
    rows,
    live,
    posts,
    spawned,
    emitted,
    triggers,
    engine,
    watcher,
    holdPosts: () => {
      hold = true;
    },
    /** Resolves once a held post is parked. */
    parked,
    releasePost: () => release?.(),
    stored: (id: string) => triggers.getStored("s1", id)!,
    armed: (id: string) =>
      Boolean(
        (
          engine as unknown as { timers: Map<string, Map<string, unknown>> }
        ).timers
          .get("s1")
          ?.has(id),
      ),
  };
}

const roots: string[] = [];
const engines: TriggerEngine[] = [];
after(() => {
  for (const engine of engines) engine.disarm("s1");
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const T0 = Date.parse("2026-11-25T00:00:00.000Z");

/** A minimal stored trigger for the pure lifecycle rules. */
function storedTrigger(over: Partial<StoredTrigger> = {}): StoredTrigger {
  return {
    id: "t",
    name: "t",
    kind: "schedule",
    enabled: true,
    source: "runtime",
    target: { type: "subagent", spec: {}, agentId: "w1" },
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

test("retirementReason stops expired and spent triggers at any check", () => {
  const expired = storedTrigger({ expiresAt: new Date(T0 - 1).toISOString() });
  assert.equal(retirementReason(expired, undefined, "fire", T0), "expired");
  const spent = storedTrigger({ maxFires: 3, fireCount: 3 });
  assert.equal(retirementReason(spent, undefined, "fire", T0), "max-fires");
  const fresh = storedTrigger({
    maxFires: 3,
    fireCount: 2,
    expiresAt: new Date(T0 + 1).toISOString(),
  });
  assert.equal(retirementReason(fresh, undefined, "fire", T0), undefined);
});

test("retirementReason stops a trigger whose sub-agent ended", () => {
  for (const status of ["completed", "killed", "error"] as const) {
    assert.equal(
      retirementReason(storedTrigger(), { status, live: false }, "fire", T0),
      "target-ended",
    );
  }
  assert.equal(
    retirementReason(
      storedTrigger(),
      { status: "active", live: true },
      "fire",
      T0,
    ),
    undefined,
  );
});

test("retirementReason retires a dormant schedule only on wake and without an expiry", () => {
  const dormant: TargetState = { status: "detached", live: false };
  assert.equal(
    retirementReason(storedTrigger(), dormant, "wake", T0),
    "target-detached",
  );
  // A firing after a restart may still revive its worker (callbacks rely on it).
  assert.equal(
    retirementReason(storedTrigger(), dormant, "fire", T0),
    undefined,
  );
  // An expiry says the watch should outlive a restart.
  assert.equal(
    retirementReason(
      storedTrigger({ expiresAt: new Date(T0 + 60_000).toISOString() }),
      dormant,
      "wake",
      T0,
    ),
    undefined,
  );
  // A detached row whose process is running again is not dormant.
  assert.equal(
    retirementReason(
      storedTrigger(),
      { status: "detached", live: true },
      "wake",
      T0,
    ),
    undefined,
  );
  // Callback triggers cost nothing until called.
  assert.equal(
    retirementReason(storedTrigger({ kind: "callback" }), dormant, "wake", T0),
    undefined,
  );
  // Prime-target triggers have no sub-agent to lose.
  assert.equal(
    retirementReason(
      storedTrigger({ target: { type: "prime" } }),
      dormant,
      "wake",
      T0,
    ),
    undefined,
  );
});

test("create resolves expiresIn and rejects bad lifetimes", () => {
  const h = lifecycleHarness();
  const before = Date.now();
  const id = h.watcher({ expiresIn: "2h", maxFires: 5 });
  const stored = h.stored(id);
  const at = Date.parse(stored.expiresAt!);
  assert.ok(at >= before + 7_200_000 && at <= Date.now() + 7_200_000);
  assert.equal(stored.maxFires, 5);
  assert.equal(h.triggers.get("s1", id)?.expiresAt, stored.expiresAt);

  assert.throws(
    () => h.watcher({ name: "past", expiresAt: "2000-01-01T00:00:00Z" }),
    /in the future/,
  );
  assert.throws(
    () => h.watcher({ name: "zero", maxFires: 0 }),
    /positive integer/,
  );
  assert.throws(
    () => h.watcher({ name: "junk", expiresIn: "soon" }),
    /duration/,
  );
});

test("a trigger switches itself off once it delivers maxFires prompts", async () => {
  const h = lifecycleHarness();
  const id = h.watcher({ maxFires: 2 });

  assert.equal(await h.engine.fire("s1", h.root, id, {}), "delivered");
  assert.equal(h.stored(id).enabled, true);
  assert.equal(await h.engine.fire("s1", h.root, id, {}), "delivered");

  const stored = h.stored(id);
  assert.equal(stored.fireCount, 2);
  assert.equal(stored.enabled, false);
  assert.equal(stored.disabledReason, "max-fires");
  assert.equal(h.posts.length, 2);
  await assert.rejects(h.engine.fire("s1", h.root, id, {}), /disabled/);
});

test("re-enabling a spent trigger clears its reason and starts a fresh budget", async () => {
  const h = lifecycleHarness();
  const id = h.watcher({ maxFires: 1 });
  await h.engine.fire("s1", h.root, id, {});
  assert.equal(h.stored(id).disabledReason, "max-fires");

  h.triggers.update("s1", id, { enabled: true });

  const stored = h.stored(id);
  assert.equal(stored.enabled, true);
  assert.equal(stored.disabledReason, undefined);
  assert.equal(stored.fireCount, 0);
});

test("an expired trigger is retired instead of firing", async () => {
  const h = lifecycleHarness();
  const id = h.watcher({ expiresIn: "1h" });
  h.stored(id).expiresAt = new Date(Date.now() - 1000).toISOString();

  assert.equal(await h.engine.fire("s1", h.root, id, {}), "retired");
  assert.equal(h.stored(id).disabledReason, "expired");
  assert.equal(h.posts.length, 0);
});

test("a trigger whose sub-agent was killed is retired, not given a fresh worker", async () => {
  const h = lifecycleHarness();
  const id = h.watcher();
  h.rows[0]!.status = "killed";
  h.live.delete("w1");

  assert.equal(await h.engine.fire("s1", h.root, id, {}), "retired");
  assert.equal(h.stored(id).disabledReason, "target-ended");
  assert.deepEqual(h.spawned, [], "no replacement sub-agent is spawned");
  assert.equal(h.posts.length, 0);
});

test("a sub-agent ending switches off the triggers it served", () => {
  const h = lifecycleHarness();
  const mine = h.watcher({ name: "mine" }, "w1");
  const other = h.watcher({ name: "other" }, "w2");

  h.engine.onAgentStatus("s1", "w1", "active");
  assert.equal(h.stored(mine).enabled, true);

  h.engine.onAgentStatus("s1", "w1", "completed");
  assert.equal(h.stored(mine).enabled, false);
  assert.equal(h.stored(mine).disabledReason, "target-ended");
  assert.equal(h.stored(other).enabled, true, "other watchers are untouched");
  assert.ok(h.emitted.includes(SocketEvents.TriggerUpdate));
});

test("waking a session retires a dormant watcher instead of re-arming it", async () => {
  const h = lifecycleHarness();
  const dormant = h.watcher({ name: "dormant" }, "w1");
  const bounded = h.watcher({ name: "bounded", expiresIn: "2d" }, "w2");
  const running = h.watcher({ name: "running" }, "w3");
  // A server restart: every sub-agent row is detached and nothing runs, except
  // w3, which (say) a revive already brought back.
  for (const row of h.rows) row.status = "detached";
  h.live.clear();
  h.live.add("w3");

  await h.engine.sync("s1", h.root);

  assert.equal(h.stored(dormant).enabled, false);
  assert.equal(h.stored(dormant).disabledReason, "target-detached");
  assert.equal(h.armed(dormant), false, "a dormant watcher is not re-armed");
  assert.equal(h.armed(bounded), true, "an expiry outlives a restart");
  assert.equal(h.armed(running), true);
  assert.equal(h.posts.length, 0, "waking delivers nothing by itself");
  // The retired watcher's worker is closed out so the revive that follows
  // doesn't bring it back idle; workers still in use are left detached.
  const status = (id: string) => h.rows.find((row) => row.id === id)?.status;
  assert.equal(status("w1"), "completed");
  assert.equal(status("w2"), "detached");
});

test("a watcher retired as dormant on wake can be re-enabled with a fresh worker", async () => {
  const h = lifecycleHarness();
  const id = h.watcher({ name: "dormant" }, "w1");
  h.rows[0]!.status = "detached";
  h.live.clear();
  await h.engine.sync("s1", h.root);
  assert.equal(h.stored(id).disabledReason, "target-detached");
  assert.equal(h.rows[0]!.status, "completed");

  h.triggers.update("s1", id, { enabled: true, expiresIn: "6h" });

  assert.equal(await h.engine.fire("s1", h.root, id, {}), "delivered");
  assert.equal(h.spawned.length, 1, "the closed-out worker is not reused");
  assert.equal(h.posts.length, 1);
});

test("unarchiving resumes watchers the archive detached", async () => {
  const h = lifecycleHarness();
  const id = h.watcher();
  h.rows[0]!.status = "detached";
  h.live.clear();

  await h.engine.sync("s1", h.root, "resume");

  assert.equal(h.stored(id).enabled, true);
  assert.equal(h.armed(id), true);
});

test("re-enabling a trigger whose sub-agent ended spawns a fresh worker", async () => {
  const h = lifecycleHarness();
  const id = h.watcher();
  h.engine.onAgentStatus("s1", "w1", "killed");
  h.rows[0]!.status = "killed";
  h.live.delete("w1");
  assert.equal(h.stored(id).disabledReason, "target-ended");

  h.triggers.update("s1", id, { enabled: true });

  assert.equal(await h.engine.fire("s1", h.root, id, {}), "delivered");
  assert.deepEqual(h.spawned, ["watch"]);
  assert.equal(h.posts.length, 1);
});

test("a disabled trigger forgets a sub-agent that ends while it is off", async () => {
  const h = lifecycleHarness();
  const id = h.watcher();
  h.triggers.update("s1", id, { enabled: false });

  h.engine.onAgentStatus("s1", "w1", "completed");
  h.rows[0]!.status = "completed";
  h.live.delete("w1");

  const target = h.stored(id).target;
  assert.equal(target.type === "subagent" && target.agentId, undefined);
  assert.equal(h.stored(id).disabledReason, undefined, "a manual off stays so");
  h.triggers.update("s1", id, { enabled: true });
  assert.equal(await h.engine.fire("s1", h.root, id, {}), "delivered");
  assert.equal(h.spawned.length, 1);
});

test("an expired trigger can only be re-enabled with a new lifetime", async () => {
  const h = lifecycleHarness();
  const id = h.watcher({ expiresIn: "1h" });
  h.stored(id).expiresAt = new Date(Date.now() - 1000).toISOString();
  await h.engine.fire("s1", h.root, id, {});
  assert.equal(h.stored(id).disabledReason, "expired");

  assert.throws(
    () => h.triggers.update("s1", id, { enabled: true }),
    /expired/,
  );
  assert.equal(h.stored(id).enabled, false, "a refused patch changes nothing");

  h.triggers.update("s1", id, { enabled: true, expiresIn: "2h" });
  assert.equal(h.stored(id).enabled, true);
  assert.equal(await h.engine.fire("s1", h.root, id, {}), "delivered");
});

test("a schedule tick is dropped while the previous one is still in flight", async () => {
  const h = lifecycleHarness();
  const id = h.watcher();
  h.holdPosts();

  const first = h.engine.fireTick("s1", h.root, h.stored(id));
  await h.parked;
  assert.equal(await h.engine.fireTick("s1", h.root, h.stored(id)), "busy");

  h.releasePost();
  assert.equal(await first, "delivered");
  assert.equal(h.posts.length, 1);
  assert.equal(h.stored(id).fireCount, 1);
});

test("a handler returning { skip: true } drops the tick without waking anyone", async () => {
  const h = lifecycleHarness();
  h.triggers.seedFromBundle("s1", h.root, [
    {
      name: "gate",
      kind: "schedule",
      handler: "triggers/gate.ts",
      schedule: { every: "1h" },
    },
  ]);
  const stored = h.triggers.listStored("s1").find((t) => t.name === "gate")!;
  const compiled = path.join(h.root, ...stored.handlerPath!.split("/"));
  mkdirSync(path.dirname(compiled), { recursive: true });
  writeFileSync(
    compiled,
    "var __tgHandler = { default: () => ({ skip: true }) };\n",
  );

  assert.equal(await h.engine.fire("s1", h.root, stored.id, {}), "skipped");
  assert.equal(h.posts.length, 0);
  assert.equal(h.stored(stored.id).fireCount, undefined);
  assert.equal(h.stored(stored.id).lastFiredAt, undefined);
});
