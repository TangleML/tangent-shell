import assert from "node:assert/strict";
import { test } from "node:test";

import type { Request, Response } from "express";

import type { PiAgentManager } from "../../pi/piAgentManager.ts";
import type { TriggerEngine } from "../../pi/triggers/triggerEngine.ts";
import type { AgentBundleStore } from "../../store/agentBundleStore.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import { handleCreateSession } from "./handlers.ts";
import { createSessionSchema } from "./schemas.ts";

class TestResponse {
  statusCode = 200;
  body: unknown;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): this {
    this.body = body;
    return this;
  }
}

test("createSessionSchema rejects blank create requests", () => {
  assert.equal(createSessionSchema.safeParse({}).success, false);
  assert.equal(createSessionSchema.safeParse({ bundleId: "" }).success, false);
  assert.equal(
    createSessionSchema.safeParse({ bundleId: "tangle" }).success,
    true,
  );
});

test("handleCreateSession returns 404 for unknown bundle ids", async () => {
  let createSessionCalled = false;
  let requestedBundleId: string | undefined;
  const store = {
    createSession: async () => {
      createSessionCalled = true;
      throw new Error("createSession should not be called");
    },
  } as unknown as SessionStore;
  const agentBundleStore = {
    readBundle: async (id: string) => {
      requestedBundleId = id;
      return undefined;
    },
  } as AgentBundleStore;
  const response = new TestResponse();

  await handleCreateSession(
    store,
    {} as PiAgentManager,
    {} as TriggerEngine,
    agentBundleStore,
    { headers: {} } as Request,
    { bundleId: "missing-bundle" },
    response as unknown as Response,
  );

  assert.equal(requestedBundleId, "missing-bundle");
  assert.equal(createSessionCalled, false);
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: "Agent bundle not found" });
});
