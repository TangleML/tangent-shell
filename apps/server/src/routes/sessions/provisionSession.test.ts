import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { ChatMessage, Session } from "@tangent/shared/contracts.ts";
import { strToU8, zipSync } from "fflate";

import type { PiAgentManager } from "../../pi/piAgentManager.ts";
import type { TriggerEngine } from "../../pi/triggers/triggerEngine.ts";
import type { AgentBundleStore } from "../../store/agentBundleStore.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import {
  provisionSession,
  SessionProvisioningError,
} from "./provisionSession.ts";

const VALID_BUNDLE = Buffer.from(
  zipSync({
    "tangent.yaml": strToU8(`schemaVersion: 1
id: test-bundle
name: Test Bundle
version: 1.0.0
prime:
  systemPrompt: prompts/prime.md
  welcomeMessage: prompts/welcome.md
  tools: []
`),
    "prompts/prime.md": strToU8("You are Prime."),
    "prompts/welcome.md": strToU8("Welcome"),
  }),
);

function sessionAt(rootPath: string): Session {
  return {
    id: "session-1",
    name: "Session 1",
    rootPath,
    status: "created",
    archived: false,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  };
}

function fixture(bundle: Buffer | null = VALID_BUNDLE) {
  const parent = mkdtempSync(path.join(tmpdir(), "provision-session-"));
  const rootPath = path.join(parent, "session-1");
  mkdirSync(rootPath);
  const session = sessionAt(rootPath);
  const messages: ChatMessage[] = [];
  const calls: string[] = [];

  const store = {
    createSession: async () => {
      calls.push("create");
      return session;
    },
    attachConfig: async (_id, config) => {
      calls.push("configure");
      return { ...session, config };
    },
    appendMessage: async (message) => {
      calls.push(`message:${message.author.id}`);
      messages.push(message);
    },
    deleteSession: async () => {
      calls.push("delete");
      return true;
    },
  } satisfies Pick<
    SessionStore,
    "createSession" | "attachConfig" | "appendMessage" | "deleteSession"
  >;
  const pi = {
    ensure: () => calls.push("ensure"),
    prompt: () => calls.push("prompt"),
    dispose: () => calls.push("dispose"),
  } satisfies Pick<PiAgentManager, "ensure" | "prompt" | "dispose">;
  const triggerEngine = {
    seed: () => calls.push("seed"),
    dispose: () => calls.push("dispose-triggers"),
  } satisfies Pick<TriggerEngine, "seed" | "dispose">;
  const agentBundleStore = {
    readBundle: async () => bundle ?? undefined,
  } satisfies Pick<AgentBundleStore, "readBundle">;

  return {
    dependencies: { store, pi, triggerEngine, agentBundleStore },
    rootPath,
    messages,
    calls,
    cleanup: () => rmSync(parent, { recursive: true, force: true }),
  };
}

test("provisions a bundle session and sends its initial prompt", async () => {
  const context = fixture();
  try {
    const session = await provisionSession(context.dependencies, {
      bundleId: "test-bundle",
      prompt: "Investigate the failure",
    });

    assert.equal(session.config?.id, "test-bundle");
    assert.deepEqual(
      context.messages.map(({ author, content }) => [author.id, content]),
      [
        ["prime", "Welcome"],
        ["api-user", "Investigate the failure"],
      ],
    );
    assert.deepEqual(context.calls, [
      "create",
      "configure",
      "seed",
      "message:prime",
      "ensure",
      "message:api-user",
      "prompt",
    ]);
  } finally {
    context.cleanup();
  }
});

test("rejects an unknown bundle before creating a session", async () => {
  const context = fixture(null);
  try {
    await assert.rejects(
      () => provisionSession(context.dependencies, { bundleId: "missing" }),
      (error: unknown) =>
        error instanceof SessionProvisioningError && error.status === 404,
    );
    assert.deepEqual(context.calls, []);
  } finally {
    context.cleanup();
  }
});

test("rolls back a session when its bundle is invalid", async () => {
  const context = fixture(Buffer.from("not a zip"));
  try {
    await assert.rejects(
      () => provisionSession(context.dependencies, { bundleId: "invalid" }),
      (error: unknown) =>
        error instanceof SessionProvisioningError && error.status === 400,
    );
    assert.deepEqual(context.calls, [
      "create",
      "dispose",
      "dispose-triggers",
      "delete",
    ]);
  } finally {
    context.cleanup();
  }
});
