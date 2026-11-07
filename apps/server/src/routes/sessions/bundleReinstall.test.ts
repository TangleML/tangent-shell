import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type {
  ReinstallBundleResponse,
  Session,
  SessionConfigMeta,
} from "@tangent/shared/contracts.ts";
import type { Request, Response } from "express";
import { zipSync } from "fflate";

import { installBundle } from "../../pi/config/bundleLoader.ts";
import type { PiAgentManager, SessionReload } from "../../pi/piAgentManager.ts";
import type { TriggerEngine } from "../../pi/triggers/triggerEngine.ts";
import type { AgentBundleStore } from "../../store/agentBundleStore.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import {
  type BundleReinstallDeps,
  BUSY_MESSAGE,
  handleReinstallBundle,
} from "./bundleReinstall.ts";

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

const encoder = new TextEncoder();

function bundle(version: string, prompt: string): Buffer {
  const files = {
    "tangent.yaml": [
      "schemaVersion: 1",
      "id: demo",
      "name: Demo",
      `version: ${version}`,
      "prime:",
      "  systemPrompt: prompts/prime.md",
    ].join("\n"),
    "prompts/prime.md": prompt,
  };
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([rel, text]) => [rel, encoder.encode(text)]),
      ),
    ),
  );
}

/** A JWT-shaped bearer whose payload carries `email` (signature unchecked). */
function bearer(email: string): string {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `Bearer ${part({ alg: "none" })}.${part({ email })}.sig`;
}

interface Harness {
  deps: BundleReinstallDeps;
  root: string;
  notes: string[];
  reloads: number;
  config: SessionConfigMeta | undefined;
  busy: boolean;
}

async function withHarness(
  fn: (h: Harness) => Promise<void>,
  owner = "owner@example.com",
): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-reinstall-route-"));
  await installBundle(bundle("1.0.0", "prime v1"), root);
  const session = {
    id: "s1",
    name: "Demo session",
    rootPath: root,
    user: { email: owner },
    config: { id: "demo", name: "Demo", version: "1.0.0" },
  } as unknown as Session;

  const h: Harness = {
    root,
    notes: [],
    reloads: 0,
    config: session.config,
    busy: false,
    deps: undefined as unknown as BundleReinstallDeps,
  };
  const reload: SessionReload = {
    primeRestarted: true,
    respawned: [],
    stopped: [],
  };
  h.deps = {
    store: {
      getSession: async () => session,
      attachConfig: async (_id: string, config: SessionConfigMeta) => {
        h.config = config;
        return { ...session, config };
      },
      listAgents: async () => [],
    } as unknown as SessionStore,
    pi: {
      isBusy: () => h.busy,
      reloadSession: () => {
        h.reloads += 1;
        return reload;
      },
    } as unknown as PiAgentManager,
    triggerEngine: { reseed: () => undefined } as unknown as TriggerEngine,
    agentBundleStore: {
      get: async () => ({ id: "demo", version: "2.0.0" }),
      readBundle: async () => bundle("2.0.0", "prime v2"),
    } as unknown as AgentBundleStore,
    postSystemNote: async (_sessionId, _conversationId, text) => {
      h.notes.push(text);
    },
    admins: new Set(["admin@example.com"]),
  };
  try {
    await fn(h);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function reinstall(
  h: Harness,
  email: string,
  body: { version?: string } = {},
): Promise<TestResponse> {
  const res = new TestResponse();
  await handleReinstallBundle(
    h.deps,
    { headers: { authorization: bearer(email) } } as Request,
    "s1",
    body,
    res as unknown as Response,
  );
  return res;
}

const prompt = (root: string) =>
  readFileSync(path.join(root, ".tangent/prompts/prime.md"), "utf8");

test("the owner reinstalls: files, metadata, agents and a session note", async () => {
  await withHarness(async (h) => {
    const res = await reinstall(h, "owner@example.com");

    assert.equal(res.statusCode, 200);
    assert.equal(prompt(h.root), "prime v2");
    assert.equal(h.config?.version, "2.0.0");
    assert.equal(h.reloads, 1, "agents are respawned");
    const { reload } = res.body as ReinstallBundleResponse;
    assert.equal(reload.previousVersion, "1.0.0");
    assert.equal(reload.version, "2.0.0");
    assert.deepEqual(h.notes, [
      "Bundle Demo updated to 1.0.0 → 2.0.0. Prime restarted with the new prompts, rules, skills and tools.",
    ]);
  });
});

test("an admin may reinstall; anyone else is refused", async () => {
  await withHarness(async (h) => {
    const denied = await reinstall(h, "member@example.com");
    assert.equal(denied.statusCode, 403);
    assert.equal(prompt(h.root), "prime v1");

    const admin = await reinstall(h, "admin@example.com");
    assert.equal(admin.statusCode, 200);
  });
});

test("a busy session is refused before anything changes", async () => {
  await withHarness(async (h) => {
    h.busy = true;
    const res = await reinstall(h, "owner@example.com");

    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body, { error: BUSY_MESSAGE });
    assert.equal(prompt(h.root), "prime v1");
    assert.equal(h.config?.version, "1.0.0");
    assert.equal(h.reloads, 0);
  });
});

test("a run that starts while staging still blocks the swap", async () => {
  await withHarness(async (h) => {
    const store = h.deps.agentBundleStore;
    h.deps.agentBundleStore = {
      ...store,
      get: store.get,
      readBundle: async (id: string) => {
        h.busy = true;
        return store.readBundle(id);
      },
    } as AgentBundleStore;
    const res = await reinstall(h, "owner@example.com");

    assert.equal(res.statusCode, 409);
    assert.equal(prompt(h.root), "prime v1");
    assert.equal(h.reloads, 0);
  });
});

test("a version other than the stored one is refused", async () => {
  await withHarness(async (h) => {
    const res = await reinstall(h, "owner@example.com", { version: "9.9.9" });
    assert.equal(res.statusCode, 409);
    assert.equal(prompt(h.root), "prime v1");
  });
});
