import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { Session } from "@tangent/shared/contracts.ts";
import express from "express";
import { strToU8, zipSync } from "fflate";

import { errorHandler } from "../middleware/errorHandler.ts";
import type { PiAgentManager } from "../pi/piAgentManager.ts";
import type { TriggerEngine } from "../pi/triggers/triggerEngine.ts";
import type { AgentBundleStore } from "../store/agentBundleStore.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import { createSessionLaunchesRouter } from "./sessionLaunches.ts";

const BUNDLE = Buffer.from(
  zipSync({
    "tangent.yaml": strToU8(`schemaVersion: 1
id: test-bundle
name: Test Bundle
version: 1.0.0
prime:
  systemPrompt: prompts/prime.md
  tools: []
`),
    "prompts/prime.md": strToU8("You are Prime."),
  }),
);

function launchDependencies(rootPath: string, prompts: string[]) {
  const session: Session = {
    id: "session-1",
    name: "Session 1",
    rootPath,
    status: "created",
    archived: false,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  };
  const store = {
    createSession: async () => session,
    attachConfig: async (_id, config) => ({ ...session, config }),
    appendMessage: async () => {},
    deleteSession: async () => true,
  } satisfies Pick<
    SessionStore,
    "createSession" | "attachConfig" | "appendMessage" | "deleteSession"
  >;
  const pi = {
    ensure: () => {},
    prompt: (_sessionId, _rootPath, prompt) => prompts.push(prompt),
    dispose: () => {},
  } satisfies Pick<PiAgentManager, "ensure" | "prompt" | "dispose">;
  const triggerEngine = {
    seed: () => {},
    dispose: () => {},
  } satisfies Pick<TriggerEngine, "seed" | "dispose">;
  const agentBundleStore = {
    readBundle: async () => BUNDLE,
  } satisfies Pick<AgentBundleStore, "readBundle">;

  return { store, pi, triggerEngine, agentBundleStore };
}

async function startApp() {
  const parent = mkdtempSync(path.join(tmpdir(), "session-launches-"));
  const rootPath = path.join(parent, "session-1");
  mkdirSync(rootPath);
  const prompts: string[] = [];
  const app = express();
  app.use(express.json());
  app.use(
    "/api/session-launches",
    createSessionLaunchesRouter(launchDependencies(rootPath, prompts)),
  );
  app.use(errorHandler);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}/api/session-launches`,
    prompts,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(parent, { recursive: true, force: true });
    },
  };
}

async function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("launches and prompts a session", async () => {
  const app = await startApp();
  try {
    const response = await post(app.url, {
      bundleId: "test-bundle",
      prompt: "Investigate the failure",
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { sessionId: "session-1" });
    assert.deepEqual(app.prompts, ["Investigate the failure"]);
  } finally {
    await app.close();
  }
});

test("rejects malformed launch requests", async () => {
  const app = await startApp();
  try {
    const response = await post(app.url, {
      bundleId: "test-bundle",
      prompt: " ",
    });

    assert.equal(response.status, 400);
    assert.deepEqual(app.prompts, []);
  } finally {
    await app.close();
  }
});
