import assert from "node:assert/strict";
import { test } from "node:test";

import type { Server } from "socket.io";

import type { ConversationRouter } from "../../conversation/conversationRouter.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import type { PiAgentManager } from "../piAgentManager.ts";
import { TriggerEngine } from "./triggerEngine.ts";
import type { StoredTrigger, TriggerManager } from "./triggerManager.ts";

const SESSION_ENV = { STUDIO_ENGINE_URL: "http://127.0.0.1:8100" };

function engineFor(target: StoredTrigger["target"]) {
  const ensured: unknown[][] = [];
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
    ensure: (...args: unknown[]) => {
      ensured.push(args);
    },
    resolveMemory: async () => undefined,
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
  assert.deepEqual(ensured[0]?.[6], SESSION_ENV);
});

test("a sub-agent-target firing revives Prime with the session's env", async () => {
  const { engine, ensured } = engineFor({
    type: "subagent",
    agentId: "a1",
    spec: { name: "worker" },
  } as StoredTrigger["target"]);
  await engine.fire("s1", "/tmp/s1", "t1", { body: { prompt: "go" } });
  assert.deepEqual(ensured[0]?.[6], SESSION_ENV);
});
