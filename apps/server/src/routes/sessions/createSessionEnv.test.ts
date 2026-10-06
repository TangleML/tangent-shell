import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { zipSync } from "fflate";

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
    ensure: (
      _sessionId: string,
      _rootPath: string,
      _config: unknown,
      _override: unknown,
      _user: unknown,
      _conversationId: string,
      env?: Record<string, string>,
    ) => {
      ensureEnv = env;
    },
  };

  const deps = {
    store,
    pi,
    triggerEngine: { seed: () => {} },
    agentBundleStore: { readBundle: async () => zip },
    memory: { initSession: () => {} },
    resources: {},
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
