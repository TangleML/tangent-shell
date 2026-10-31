import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { MemoryBinding } from "@tangent/shared/contracts.ts";

// Point roots at throwaway dirs before importing config-reading modules.
const SESS = mkdtempSync(path.join(tmpdir(), "mem-sess-"));
const SHARED = mkdtempSync(path.join(tmpdir(), "mem-shared-"));
const MEM = mkdtempSync(path.join(tmpdir(), "mem-global-"));
process.env.SESSIONS_ROOT = SESS;
process.env.SHARED_ROOT = SHARED;
process.env.GLOBAL_MEMORY_DIR = MEM;

const { CompositeMemory } = await import("./composite.ts");
const { PiMemory } = await import("./piMemory.ts");
const { SimpleMdMemory } = await import("./simpleMd.ts");
const { MemoryResolver } = await import("./resolver.ts");
import type { SessionStore } from "../store/sessionStore.ts";
import type { MemoryBackend, MemoryContext } from "./types.ts";

after(() => {
  for (const dir of [SESS, SHARED, MEM]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const CTX: MemoryContext = { sessionId: "s1", rootPath: SESS };

/** A trivial leaf used to probe composite routing without touching disk. */
function fakeLeaf(
  over: Partial<MemoryBackend> & { kind: string },
): MemoryBackend {
  return {
    kind: over.kind,
    init: over.init ?? (() => {}),
    preamble: over.preamble ?? (() => ""),
    tools: over.tools ?? (() => []),
    spawn: over.spawn,
    execute: over.execute ?? (() => undefined),
  };
}

test("CompositeMemory concatenates preambles and routes execute to the owner", () => {
  const a = fakeLeaf({
    kind: "a",
    preamble: () => "A-pre",
    execute: (name) => (name === "ta" ? { text: "from-a" } : undefined),
  });
  const b = fakeLeaf({
    kind: "b",
    preamble: () => "B-pre",
    execute: (name) => (name === "tb" ? { text: "from-b" } : undefined),
  });
  const composite = new CompositeMemory([a, b]);

  assert.equal(composite.preamble(CTX), "A-pre\n\nB-pre");
  assert.equal(composite.execute("tb", {}, CTX)?.text, "from-b");
  assert.equal(composite.execute("unknown", {}, CTX), undefined);
});

test("CompositeMemory merges spawn extras and dedupes allowlist tools", () => {
  const a = fakeLeaf({
    kind: "a",
    spawn: () => ({ env: { A: "1" }, allowlistTools: ["x"] }),
  });
  const b = fakeLeaf({
    kind: "b",
    spawn: () => ({
      env: { B: "2" },
      extensionPaths: ["/ext/b.ts"],
      allowlistTools: ["x", "y"],
    }),
  });
  const extras = new CompositeMemory([a, b]).spawn(CTX, "prime");

  assert.deepEqual(extras.env, { A: "1", B: "2" });
  assert.deepEqual(extras.extensionPaths, ["/ext/b.ts"]);
  assert.deepEqual(new Set(extras.allowlistTools), new Set(["x", "y"]));
});

test("PiMemory grants all tools to prime and read-only to sub-agents", () => {
  const pi = new PiMemory("/tmp/pm");

  const prime = pi.spawn(CTX, "prime");
  assert.equal(prime.env?.PI_MEMORY_DIR, "/tmp/pm");
  assert.equal(prime.extensionPaths?.length, 1);
  assert.deepEqual(
    new Set(prime.allowlistTools),
    new Set([
      "memory_write",
      "memory_forget",
      "memory_restore",
      "memory_read",
      "scratchpad",
      "memory_search",
      "memory_status",
    ]),
  );

  const sub = pi.spawn(CTX, "subagent");
  assert.deepEqual(
    new Set(sub.allowlistTools),
    new Set(["memory_read", "memory_search", "memory_status"]),
  );
  assert.equal(pi.tools().length, 0);
});

test("PiMemory maps config onto env knobs and drops search when disabled", () => {
  const pi = new PiMemory("/tmp/pm", {
    exitSummary: false,
    snapshot: "per-turn",
    qmdUpdate: "off",
    search: false,
    exitSummaryModel: "anthropic/claude",
  });
  const prime = pi.spawn(CTX, "prime");

  assert.deepEqual(prime.env, {
    PI_MEMORY_DIR: "/tmp/pm",
    PI_MEMORY_EXIT_SUMMARY: "0",
    PI_MEMORY_SNAPSHOT: "per-turn",
    PI_MEMORY_QMD_UPDATE: "off",
    PI_MEMORY_NO_SEARCH: "1",
    PI_MEMORY_EXIT_SUMMARY_MODEL: "anthropic/claude",
  });
  assert.equal(prime.allowlistTools?.includes("memory_search"), false);
});

test("PiMemory with no config is max memory power (only PI_MEMORY_DIR)", () => {
  const prime = new PiMemory("/tmp/pm").spawn(CTX, "prime");
  assert.deepEqual(prime.env, { PI_MEMORY_DIR: "/tmp/pm" });
});

/** A SessionStore stub whose only live method is getSessionMemory. */
function sessionStoreWith(binding: MemoryBinding | undefined): SessionStore {
  return {
    getSessionMemory: async () => binding,
  } as unknown as SessionStore;
}

test("resolveDefault is SimpleMD only (no shared extension or env)", () => {
  const resolver = new MemoryResolver(new SimpleMdMemory());
  const plan = resolver.resolveDefault("s1", SESS).spawnPlan("prime");

  assert.equal(plan.extensionPaths.length, 0);
  assert.deepEqual(plan.env, {});
  assert.ok(plan.allowlistTools.includes("read_memory"));
  assert.equal(plan.allowlistTools.includes("memory_write"), false);
});

test("resolve points a pi-memory binding's root into a mounted folder", async () => {
  const resolver = new MemoryResolver(
    new SimpleMdMemory(),
    sessionStoreWith({ kind: "pi-memory", root: "proj/pi-memory" }),
  );

  const plan = (await resolver.resolve("s1", SESS)).spawnPlan("prime");

  assert.equal(plan.env.PI_MEMORY_DIR, path.join(SESS, "proj/pi-memory"));
  assert.equal(plan.extensionPaths.length, 1);
  assert.ok(plan.allowlistTools.includes("read_memory"));
  assert.ok(plan.allowlistTools.includes("memory_write"));
});

test("resolve defaults a rootless pi-memory binding to a session-local dir", async () => {
  const resolver = new MemoryResolver(
    new SimpleMdMemory(),
    sessionStoreWith({ kind: "pi-memory" }),
  );

  const plan = (await resolver.resolve("s1", SESS)).spawnPlan("prime");
  assert.equal(plan.env.PI_MEMORY_DIR, path.join(SESS, ".pi-memory"));
});

test("resolve falls back to SimpleMD when the session has no binding", async () => {
  const resolver = new MemoryResolver(
    new SimpleMdMemory(),
    sessionStoreWith(undefined),
  );

  const plan = (await resolver.resolve("s1", SESS)).spawnPlan("prime");
  assert.equal(plan.extensionPaths.length, 0);
  assert.deepEqual(plan.env, {});
});

test("resolve rejects a binding root that escapes the session root", async () => {
  const resolver = new MemoryResolver(
    new SimpleMdMemory(),
    sessionStoreWith({ kind: "pi-memory", root: "../escape" }),
  );

  const plan = (await resolver.resolve("s1", SESS)).spawnPlan("prime");
  assert.equal(plan.extensionPaths.length, 0);
  assert.deepEqual(plan.env, {});
});
