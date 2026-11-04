import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { MemoryBinding } from "@tangent/shared/contracts.ts";
import { zipSync } from "fflate";

import type { PrimeSpawnOptions } from "../../pi/piAgentManager.ts";

// Point the session root at a throwaway dir before importing modules that read
// config at load time.
const ROOT = mkdtempSync(path.join(tmpdir(), "create-session-env-"));
process.env.SESSIONS_ROOT = ROOT;

const { handleCreateSession } = await import("./handlers.ts");
const { InMemorySessionStore } =
  await import("../../store/inMemorySessionStore.ts");

after(() => rmSync(ROOT, { recursive: true, force: true }));

/**
 * Builds the smallest valid Configuration Bundle ZIP in memory: a manifest and
 * the Prime system prompt it references. Keeps this test independent of any
 * on-disk example bundle.
 */
function packMinimalBundle(): Buffer {
  const encoder = new TextEncoder();
  const manifest = [
    "schemaVersion: 1",
    "id: test-bundle",
    "name: Test Bundle",
    "version: 1.0.0",
    "prime:",
    "  systemPrompt: prime/system.md",
    "",
  ].join("\n");
  return Buffer.from(
    zipSync({
      "tangent.yaml": encoder.encode(manifest),
      "prime/system.md": encoder.encode("You are a test agent."),
    }),
  );
}

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

test("handleCreateSession persists env and forwards it into pi.ensure", async () => {
  const store = new InMemorySessionStore();
  const zip = packMinimalBundle();

  let ensureEnv: Record<string, string> | undefined;
  const pi = {
    ensure: async (
      _sessionId: string,
      _rootPath: string,
      options: PrimeSpawnOptions,
    ) => {
      ensureEnv = options.env;
    },
  };

  const deps = {
    store,
    pi,
    triggerEngine: { seed: () => {} },
    agentBundleStore: { readBundle: async () => zip },
    resources: { listForSession: async () => [] },
    hostPreamble: { refresh: async () => {} },
    emitResourcesUpdated: () => {},
  } as unknown as Parameters<typeof handleCreateSession>[0];

  const response = new TestResponse();
  const env = { TANGLE_ROOT_CONFIG: "annotations.project=p1" };

  await handleCreateSession(
    deps,
    { headers: {} } as unknown as Parameters<typeof handleCreateSession>[1],
    { bundleId: "test-bundle", env },
    response as unknown as Parameters<typeof handleCreateSession>[3],
  );

  assert.equal(response.statusCode, 201, "the session is created");
  const sessionId = (response.body as { session: { id: string } }).session.id;

  assert.deepEqual(
    await store.getSessionEnv(sessionId),
    env,
    "env is persisted server-side",
  );
  assert.deepEqual(ensureEnv, env, "env is forwarded into the Prime spawn");
});

/** Creates a session with `memory`, returning the binding it ended up storing
 * and the order the memory and trigger steps ran in. */
async function createWithMemory(memory: MemoryBinding) {
  const store = new InMemorySessionStore();
  const steps: string[] = [];
  const setSessionMemory = store.setSessionMemory.bind(store);
  store.setSessionMemory = async (...args) => {
    steps.push("memory");
    return setSessionMemory(...args);
  };
  const deps = {
    store,
    pi: { ensure: async () => {} },
    triggerEngine: { seed: () => steps.push("triggers") },
    agentBundleStore: { readBundle: async () => packMinimalBundle() },
    resources: { listForSession: async () => [] },
    hostPreamble: { refresh: async () => {} },
    emitResourcesUpdated: () => {},
  } as unknown as Parameters<typeof handleCreateSession>[0];

  const response = new TestResponse();
  await handleCreateSession(
    deps,
    { headers: {} } as unknown as Parameters<typeof handleCreateSession>[1],
    { bundleId: "test-bundle", memory },
    response as unknown as Parameters<typeof handleCreateSession>[3],
  );
  assert.equal(response.statusCode, 201, "the session is created");
  const sessionId = (response.body as { session: { id: string } }).session.id;
  return { stored: await store.getSessionMemory(sessionId), steps };
}

test("handleCreateSession stores a session-local pi-memory binding before arming triggers", async () => {
  const { stored, steps } = await createWithMemory({ kind: "pi-memory" });
  assert.deepEqual(stored, { kind: "pi-memory" });
  assert.deepEqual(steps, ["memory", "triggers"]);
});

test("handleCreateSession drops pi-memory whose folder wasn't mounted", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { stored } = await createWithMemory({
    kind: "pi-memory",
    root: "proj/pi-memory",
  });
  assert.equal(stored, undefined, "the session is SimpleMD-only for good");
});
