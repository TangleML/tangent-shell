import assert from "node:assert/strict";
import { test } from "node:test";

import { handleCreateSession } from "./handlers.ts";
import { createSessionSchema } from "./schemas.ts";
import {
  AgentBundleNotFoundError,
  InvalidAgentBundleError,
  type SessionProvisioner,
} from "./sessionProvisioner.ts";

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

function rejectingProvisioner(error: Error): SessionProvisioner {
  return {
    create: async () => {
      throw error;
    },
  };
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
  const response = new TestResponse();

  await handleCreateSession(
    rejectingProvisioner(
      new AgentBundleNotFoundError("Agent bundle not found"),
    ),
    { headers: {} },
    { bundleId: "missing-bundle" },
    response,
  );

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: "Agent bundle not found" });
});

test("handleCreateSession returns 400 for invalid bundles", async () => {
  const response = new TestResponse();

  await handleCreateSession(
    rejectingProvisioner(new InvalidAgentBundleError("Invalid manifest")),
    { headers: {} },
    { bundleId: "broken-bundle" },
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "Invalid manifest" });
});
