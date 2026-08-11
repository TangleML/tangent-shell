import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { ChatMessage, Session } from "@tangent/shared/contracts.ts";

import type { ResolvedSessionConfig } from "../../pi/agentConfig.ts";
import type { InstalledBundle } from "../../pi/config/bundleLoader.ts";
import type { PiAgentManager } from "../../pi/piAgentManager.ts";
import type { TriggerEngine } from "../../pi/triggers/triggerEngine.ts";
import type { AgentBundleStore } from "../../store/agentBundleStore.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import {
  AgentBundleNotFoundError,
  DefaultSessionProvisioner,
  InvalidAgentBundleError,
  type SessionProvisioner,
} from "./sessionProvisioner.ts";

const ZIP = Buffer.from("bundle");

function installedBundle(): InstalledBundle {
  return {
    manifest: {
      schemaVersion: 1,
      id: "test-bundle",
      name: "Test Bundle",
      version: "1.0.0",
      prime: { systemPrompt: "prompts/prime.md" },
    },
    config: {
      prime: {
        tools: [],
        appendSystemPrompt: "",
      },
      subagentDefaults: {},
      templates: new Map(),
      skillPaths: [],
      workflowPaths: [],
      extensionPaths: [],
      welcomeMessage: "Welcome",
    } satisfies ResolvedSessionConfig,
  };
}

function sessionAt(rootPath: string): Session {
  return {
    id: "session-1",
    name: "Session 1",
    rootPath,
    status: "created",
    archived: false,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

interface Fixture {
  provisioner: SessionProvisioner;
  session: Session;
  messages: ChatMessage[];
  calls: string[];
  cleanup(): void;
}

interface FixtureOptions {
  bundle?: Buffer | null;
  install?: () => Promise<InstalledBundle>;
}

function fixture(options?: FixtureOptions): Fixture {
  const parent = mkdtempSync(path.join(tmpdir(), "session-provisioner-"));
  const rootPath = path.join(parent, "session-1");
  mkdirSync(rootPath, { recursive: true });
  const session = sessionAt(rootPath);
  const messages: ChatMessage[] = [];
  const calls: string[] = [];

  const store = {
    createSession: async () => {
      calls.push("create");
      return session;
    },
    attachConfig: async (_id: string, config: Session["config"]) => {
      calls.push("attach-config");
      return { ...session, config };
    },
    appendMessage: async (message: ChatMessage) => {
      calls.push(`append:${message.author.id}`);
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
  const bundles = {
    readBundle: async () =>
      options?.bundle === null ? undefined : (options?.bundle ?? ZIP),
  } satisfies Pick<AgentBundleStore, "readBundle">;
  const installer = async () =>
    options?.install ? options.install() : installedBundle();

  return {
    provisioner: new DefaultSessionProvisioner(
      store,
      pi,
      triggerEngine,
      bundles,
      installer,
    ),
    session,
    messages,
    calls,
    cleanup: () => rmSync(parent, { recursive: true, force: true }),
  };
}

test("provisions a bundle session and dispatches the initial prompt", async () => {
  const ctx = fixture();
  try {
    const session = await ctx.provisioner.create({
      bundleId: "test-bundle",
      prompt: "Investigate the failure",
    });

    assert.equal(session.config?.id, "test-bundle");
    assert.deepEqual(
      ctx.messages.map((message) => [message.author.id, message.content]),
      [
        ["prime", "Welcome"],
        ["external-user", "Investigate the failure"],
      ],
    );
    assert.deepEqual(ctx.calls, [
      "create",
      "attach-config",
      "seed",
      "append:prime",
      "ensure",
      "append:external-user",
      "prompt",
    ]);
  } finally {
    ctx.cleanup();
  }
});

test("removes all state and files when provisioning fails", async () => {
  const ctx = fixture({
    install: async () => {
      throw new Error("bad bundle");
    },
  });
  try {
    await assert.rejects(
      () => ctx.provisioner.create({ bundleId: "test-bundle" }),
      InvalidAgentBundleError,
    );

    assert.equal(existsSync(ctx.session.rootPath), false);
    assert.deepEqual(ctx.calls, [
      "create",
      "dispose",
      "dispose-triggers",
      "delete",
    ]);
  } finally {
    ctx.cleanup();
  }
});

test("rejects an unknown bundle before creating a session", async () => {
  const ctx = fixture({ bundle: null });
  try {
    await assert.rejects(
      () => ctx.provisioner.create({ bundleId: "missing" }),
      AgentBundleNotFoundError,
    );
  } finally {
    ctx.cleanup();
  }
});
