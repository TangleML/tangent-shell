import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import type {
  LaunchSessionResponse,
  Session,
} from "@tangent/shared/contracts.ts";
import express from "express";

import { errorHandler } from "../middleware/errorHandler.ts";
import {
  createSessionLaunchesRouter,
  launchSessionSchema,
} from "./sessionLaunches.ts";
import {
  AgentBundleNotFoundError,
  InvalidAgentBundleError,
  type ProvisionSessionInput,
  type SessionProvisioner,
} from "./sessions/sessionProvisioner.ts";

function session(): Session {
  return {
    id: "session-1",
    name: "Session 1",
    rootPath: "/tmp/session-1",
    status: "created",
    archived: false,
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
  };
}

async function startApp(provisioner: SessionProvisioner) {
  const app = express();
  app.use(express.json());
  app.use("/api/session-launches", createSessionLaunchesRouter(provisioner));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}/api/session-launches`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function fakeProvisioner(
  create: (input: ProvisionSessionInput) => Promise<Session>,
): SessionProvisioner {
  return { create };
}

async function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("launch schema requires exactly bundleId and prompt", () => {
  assert.equal(
    launchSessionSchema.safeParse({ bundleId: "bundle", prompt: "Run" })
      .success,
    true,
  );
  assert.equal(
    launchSessionSchema.safeParse({ bundleId: "bundle" }).success,
    false,
  );
  assert.equal(
    launchSessionSchema.safeParse({
      bundleId: "bundle",
      prompt: "Run",
      name: "Unexpected",
    }).success,
    false,
  );
});

test("launch endpoint creates and prompts a session", async () => {
  let received: ProvisionSessionInput | undefined;
  const provisioner = fakeProvisioner(async (input) => {
    received = input;
    return session();
  });
  const app = await startApp(provisioner);

  try {
    const response = await post(app.url, {
      bundleId: "tangle-oss",
      prompt: "Investigate the latest failed run",
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      sessionId: "session-1",
    } satisfies LaunchSessionResponse);
    assert.equal(received?.bundleId, "tangle-oss");
    assert.equal(received?.prompt, "Investigate the latest failed run");
  } finally {
    await app.close();
  }
});

test("launch endpoint rejects malformed requests", async () => {
  const provisioner = fakeProvisioner(async () => session());
  const app = await startApp(provisioner);

  try {
    const response = await post(app.url, { bundleId: "tangle-oss" });
    assert.equal(response.status, 400);
  } finally {
    await app.close();
  }
});

test("launch endpoint reports missing and invalid bundles", async () => {
  const missingApp = await startApp(
    fakeProvisioner(async () => {
      throw new AgentBundleNotFoundError("Agent bundle not found");
    }),
  );
  const invalidApp = await startApp(
    fakeProvisioner(async () => {
      throw new InvalidAgentBundleError("Invalid manifest");
    }),
  );

  try {
    const body = { bundleId: "bundle", prompt: "Run" };
    assert.equal((await post(missingApp.url, body)).status, 404);
    assert.equal((await post(invalidApp.url, body)).status, 400);
  } finally {
    await missingApp.close();
    await invalidApp.close();
  }
});
