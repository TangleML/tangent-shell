import assert from "node:assert/strict";
import { test } from "node:test";

import type { Server } from "socket.io";

import type { ConversationRouter } from "../../conversation/conversationRouter.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import type { PiAgentManager, PrimeSpawnOptions } from "../piAgentManager.ts";
import { TriggerEngine } from "./triggerEngine.ts";
import type { StoredTrigger, TriggerManager } from "./triggerManager.ts";

const SESSION_ENV = { STUDIO_ENGINE_URL: "http://127.0.0.1:8100" };

function engineFor(
  target: StoredTrigger["target"],
  identity: Pick<StoredTrigger, "participantId" | "delegationToken"> = {},
) {
  const ensured: PrimeSpawnOptions[] = [];
  const seeded: unknown[] = [];
  const stored = {
    id: "t1",
    name: "engine-step",
    kind: "callback",
    enabled: true,
    prompt: "{{body.prompt}}",
    target,
    ...identity,
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
    undefined,
    {
      recordAudience: (...args: unknown[]) => {
        seeded.push(args);
      },
    },
  );
  return { engine, ensured, seeded };
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

test("a firing makes the target act for the trigger's creator, under its delegation", async () => {
  const delegated = engineFor(
    { type: "subagent", agentId: "sub-1", spec: { name: "step" } },
    { participantId: "alice@x", delegationToken: "delegation-token" },
  );
  await delegated.engine.fire("s1", "/tmp/s1", "t1", {
    body: { prompt: "go" },
  });
  assert.deepEqual(delegated.seeded, [
    [
      "s1",
      "sub-1",
      ["alice@x"],
      { participantId: "alice@x", token: "delegation-token" },
    ],
  ]);

  const bound = engineFor({ type: "prime" }, { participantId: "alice@x" });
  await bound.engine.fire("s1", "/tmp/s1", "t1", { body: { prompt: "go" } });
  assert.equal(bound.seeded.length, 1);
  assert.deepEqual((bound.seeded[0] as unknown[]).slice(2), [
    ["alice@x"],
    undefined,
  ]);

  const anonymous = engineFor({ type: "prime" });
  await anonymous.engine.fire("s1", "/tmp/s1", "t1", {
    body: { prompt: "go" },
  });
  assert.deepEqual(anonymous.seeded, []);
});
