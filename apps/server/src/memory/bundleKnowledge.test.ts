import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point roots at throwaway dirs before importing config-reading modules.
const SESS = mkdtempSync(path.join(tmpdir(), "kb-sess-"));
const SHARED = mkdtempSync(path.join(tmpdir(), "kb-shared-"));
const QMD = mkdtempSync(path.join(tmpdir(), "kb-qmd-"));
const BUNDLES = mkdtempSync(path.join(tmpdir(), "kb-bundles-"));
process.env.SESSIONS_ROOT = SESS;
process.env.SHARED_ROOT = SHARED;
process.env.QMD_STATE_ROOT = QMD;
process.env.BUNDLE_MEMORY_ROOT = BUNDLES;

const { BundleKbRegistry } = await import("./bundleKbRegistry.ts");
const { BundleKnowledgeMemory } = await import("./bundleKnowledge.ts");
const { forgetBlocks } = await import("./bundleKbStore.ts");
const { parseEntries } = await import("./memoryDigest.ts");
const { parseQmdHits, QmdIndexer, QmdRunner } = await import("./qmdRunner.ts");
import type { QmdExec, QmdExecOptions } from "./qmdRunner.ts";
import type { AgentRole, MemoryContext, MemoryExecuteResult } from "./types.ts";

after(() => {
  for (const dir of [SESS, SHARED, QMD, BUNDLES]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const CTX: MemoryContext = { sessionId: "session-abcdef123", rootPath: SESS };
const NOW = new Date("2026-03-04T05:06:07Z");

interface ExecCall {
  args: readonly string[];
  options: QmdExecOptions;
}

/** A qmd stand-in that records its calls and answers with `stdout`. */
function fakeExec(stdout = "[]"): { exec: QmdExec; calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  const exec: QmdExec = async (args, options) => {
    calls.push({ args, options });
    return { stdout };
  };
  return { exec, calls };
}

let storeCount = 0;

/** A fresh store under its own bundle id, with its leaf. */
function kb(exec: QmdExec = fakeExec().exec) {
  const registry = new BundleKbRegistry({
    runner: new QmdRunner(exec),
    debounceMs: 0,
  });
  const store = registry.get(`bundle-${++storeCount}`);
  store.ensure();
  return { registry, store, leaf: new BundleKnowledgeMemory(store, registry) };
}

/** Runs one of the leaf's tools, failing the test if the leaf doesn't own it. */
async function call(
  leaf: InstanceType<typeof BundleKnowledgeMemory>,
  name: string,
  params: Record<string, unknown>,
  role: AgentRole = "prime",
): Promise<MemoryExecuteResult> {
  const result = await leaf.execute(name, params, CTX, role);
  assert.ok(result, `${name} is handled`);
  return result;
}

test("append stamps long-term and daily entries in pi-memory's format", () => {
  const { store } = kb();

  const rel = store.append(
    {
      target: "long_term",
      content: " Use v2 of the API ",
      tags: ["#decision", "api client"],
      sessionId: CTX.sessionId,
    },
    NOW,
  );
  assert.equal(rel, "MEMORY.md");
  assert.equal(
    store.readMemory(),
    "<!-- 2026-03-04 05:06:07 [session-] -->\nUse v2 of the API\n\n#decision #api-client",
  );

  const daily = store.append(
    { target: "daily", content: "ran the ingest", sessionId: CTX.sessionId },
    NOW,
  );
  assert.equal(daily, path.join("daily", "2026-03-04.md"));
  assert.match(store.read(daily) ?? "", /ran the ingest/);
  assert.deepEqual(store.listFiles(), [
    "MEMORY.md",
    path.join("daily", "2026-03-04.md"),
  ]);
});

test("forgetBlocks removes whole stamped entries and unstamped paragraphs", () => {
  const content = [
    "# Notes",
    "",
    "old intro paragraph",
    "<!-- 2026-01-01 00:00:00 [aaaa] -->",
    "first fact",
    "",
    "with a second paragraph",
    "<!-- 2026-01-02 00:00:00 [bbbb] -->",
    "second fact",
  ].join("\n");

  const { kept, removed } = forgetBlocks(content, "SECOND PARAGRAPH");
  assert.deepEqual(removed, [
    "<!-- 2026-01-01 00:00:00 [aaaa] -->\nfirst fact\n\nwith a second paragraph",
  ]);
  assert.deepEqual(kept, [
    "# Notes",
    "old intro paragraph",
    "<!-- 2026-01-02 00:00:00 [bbbb] -->\nsecond fact",
  ]);
});

test("forget refuses a match hitting too many entries", () => {
  const { store } = kb();
  for (let i = 0; i < 6; i++) {
    store.append({
      target: "long_term",
      content: `shared phrase ${i}`,
      sessionId: "s",
    });
  }
  const before = store.readMemory();

  assert.deepEqual(store.forget("shared phrase"), {
    kind: "too-many",
    count: 6,
  });
  assert.equal(store.readMemory(), before);
  assert.equal(store.forget("shared phrase 3").kind, "removed");
  assert.doesNotMatch(store.readMemory(), /shared phrase 3/);
});

test("read only serves markdown files inside the store", () => {
  const { store } = kb();
  store.append({ target: "long_term", content: "fact", sessionId: "s" });

  assert.match(store.read("MEMORY.md") ?? "", /fact/);
  assert.equal(store.read("../MEMORY.md"), undefined);
  assert.equal(store.read("/etc/hosts"), undefined);
  assert.equal(store.read(".audit.jsonl"), undefined);
  assert.equal(store.read("missing.md"), undefined);
});

test("seedIfNew seeds a new store once and ignores non-markdown files", () => {
  const registry = new BundleKbRegistry({
    runner: new QmdRunner(fakeExec().exec),
  });
  const store = registry.get("seeded-bundle");

  const seeded = store.seedIfNew([
    { name: "MEMORY.md", content: "# Seeded\n" },
    { name: "nested/glossary.md", content: "terms\n" },
    { name: "notes.txt", content: "skip\n" },
  ]);
  assert.equal(seeded, true);
  assert.equal(store.readMemory(), "# Seeded");
  assert.deepEqual(store.listFiles(), ["MEMORY.md", "glossary.md"]);
  assert.ok(existsSync(path.join(store.stateDir, "index.yml")));

  assert.equal(
    store.seedIfNew([{ name: "MEMORY.md", content: "# Replaced\n" }]),
    false,
  );
  assert.equal(store.readMemory(), "# Seeded");
});

test("the registry keys stores by bundle id and rejects other ids", () => {
  const registry = new BundleKbRegistry();
  assert.equal(registry.get("research"), registry.get("research"));
  assert.equal(
    registry.get("research").dir,
    path.join(realpathSync(BUNDLES), "research"),
  );
  assert.equal(
    registry.get("research").stateDir,
    path.join(QMD, "bundles", "research"),
  );
  assert.throws(() => registry.get("../escape"));
  assert.throws(() => registry.get("Upper"));
});

test("tools: everyone searches and reads, only Prime writes", async () => {
  const { leaf, store } = kb();
  assert.deepEqual(
    leaf.tools("prime").map((tool) => tool.name),
    ["kb_search", "kb_read", "kb_write", "kb_forget"],
  );
  assert.deepEqual(
    leaf.tools("subagent").map((tool) => tool.name),
    ["kb_search", "kb_read"],
  );

  for (const name of ["kb_write", "kb_forget"]) {
    const result = await leaf.execute(
      name,
      { content: "x", match: "xxxx" },
      CTX,
      "subagent",
    );
    assert.equal(result?.error, true, `${name} is Prime-only`);
  }
  assert.equal(store.readMemory(), "");
  assert.equal(await leaf.execute("remember", {}, CTX, "prime"), undefined);
});

test("kb_write stores, audits, highlights, and schedules a reindex", async () => {
  const { exec, calls } = fakeExec();
  const { leaf, store, registry } = kb(exec);

  const result = await leaf.execute(
    "kb_write",
    { title: "Batch jobs", content: "Prefer batch jobs", tags: ["lesson"] },
    CTX,
    "prime",
  );
  assert.equal(result?.error, undefined);
  assert.deepEqual(result?.effects, [
    { kind: "remembered", scope: "bundle", text: "Prefer batch jobs" },
  ]);
  assert.match(
    store.readMemory(),
    /-->\n### Batch jobs\nPrefer batch jobs\n\n#lesson/,
  );

  const audit = readFileSync(path.join(store.dir, ".audit.jsonl"), "utf8");
  assert.match(audit, /"tool":"kb_write"/);
  assert.match(audit, /"sessionId":"session-abcdef123"/);

  await new Promise((resolve) => setTimeout(resolve, 5));
  await registry.indexer.idle();
  assert.deepEqual(
    calls.map((call) => call.args[0]),
    ["update", "embed"],
  );
});

test("kb_write and kb_forget validate their params", async () => {
  const { leaf } = kb();
  const blank = await call(leaf, "kb_write", { title: "Blank", content: "  " });
  assert.equal(blank.error, true);
  const untitled = await call(leaf, "kb_write", { content: "fact" });
  assert.equal(untitled.error, true);
  assert.match(untitled.text, /title/);
  const short = await call(leaf, "kb_forget", { match: "ab" });
  assert.equal(short.error, true);
  assert.match(short.text, /at least 4 characters/);
});

test("kb_search runs qmd against the store's own index", async () => {
  const stdout = [
    "Searching...",
    JSON.stringify([
      {
        file: "qmd://pi-memory/daily/2026-03-04.md",
        score: 0.9,
        snippet: "batch jobs win",
      },
    ]),
  ].join("\n");
  const { exec, calls } = fakeExec(stdout);
  const { leaf, store } = kb(exec);

  const result = await leaf.execute(
    "kb_search",
    { query: "batch", mode: "semantic", limit: 3 },
    CTX,
    "subagent",
  );
  assert.equal(result?.error, undefined);
  assert.match(
    result?.text ?? "",
    /1\. `daily\/2026-03-04\.md` \(score 0\.9\)/,
  );
  assert.match(result?.text ?? "", /batch jobs win/);

  const [call] = calls;
  assert.deepEqual(call.args, [
    "vsearch",
    "--json",
    "-c",
    "pi-memory",
    "-n",
    "3",
    "batch",
  ]);
  assert.equal(call.options.cwd, store.stateDir);
  assert.equal(call.options.env.QMD_CONFIG_DIR, store.stateDir);
  assert.equal(
    call.options.env.INDEX_PATH,
    path.join(store.stateDir, "index.sqlite"),
  );
});

test("kb_search rejects flag-like queries and reports a missing qmd", async () => {
  const missing: QmdExec = async () => {
    throw Object.assign(new Error("spawn qmd ENOENT"), { code: "ENOENT" });
  };
  const { leaf } = kb(missing);

  const flag = await leaf.execute(
    "kb_search",
    { query: "--index" },
    CTX,
    "prime",
  );
  assert.equal(flag?.error, true);

  const result = await leaf.execute("kb_search", { query: "x" }, CTX, "prime");
  assert.equal(result?.error, true);
  assert.match(result?.text ?? "", /qmd is not installed/);
});

test("parseQmdHits tolerates progress lines and empty results", () => {
  assert.deepEqual(parseQmdHits("No results found."), []);
  assert.deepEqual(parseQmdHits(""), []);
  assert.deepEqual(
    parseQmdHits(
      `\u001b[2mloading\u001b[0m\n${JSON.stringify({ results: [{ path: "MEMORY.md", content: " a " }, { score: 1 }] })}`,
    ),
    [{ path: "MEMORY.md", score: undefined, text: "a" }],
  );
});

test("the indexer debounces writes and never queues a store twice", async () => {
  const { exec, calls } = fakeExec();
  const indexer = new QmdIndexer(new QmdRunner(exec), 10);
  const dir = path.join(QMD, "bundles", "debounced");

  indexer.schedule(dir);
  indexer.schedule(dir);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await indexer.idle();
  assert.equal(calls.length, 2);

  calls.length = 0;
  void indexer.enqueue(dir);
  void indexer.enqueue(dir);
  await indexer.idle();
  assert.deepEqual(
    calls.map((call) => call.args[0]),
    ["update", "embed"],
  );
});

test("a large store's preamble lists every entry, newest first, by id", () => {
  const { leaf, store } = kb();
  store.append(
    {
      target: "long_term",
      title: "Old bulk",
      content: "x".repeat(5000),
      tags: ["bulk"],
      sessionId: "s",
    },
    new Date("2026-01-01T00:00:00Z"),
  );
  store.append(
    {
      target: "long_term",
      title: "Newest TAIL",
      content: "tail",
      sessionId: "s",
    },
    new Date("2026-02-01T00:00:00Z"),
  );

  const preamble = leaf.preamble();
  assert.match(preamble, /^### Bundle knowledge base: MEMORY\.md$/m);
  assert.doesNotMatch(preamble, /xxxx/);
  assert.match(preamble, /2 entries, .* KB, newest 2026-02-01/);
  assert.match(
    preamble,
    /- `[0-9a-f]{6}` Newest TAIL \(2026-02-01\)\n- `[0-9a-f]{6}` Old bulk \(2026-01-01\) #bulk/,
  );
  assert.match(preamble, /Keywords:\n\n- #bulk: `[0-9a-f]{6}`/);
  assert.equal(leaf.describe(CTX, "prime")[0].digest?.mode, "contents");
});

test("describe offers writes and the trust warning to Prime only", () => {
  const { leaf } = kb();
  const [prime] = leaf.describe(CTX, "prime");
  assert.deepEqual(prime.write, { tools: ["kb_write", "kb_forget"] });
  assert.match(prime.notes?.join(" ") ?? "", /never store session-specific/);

  const [sub] = leaf.describe(CTX, "subagent");
  assert.deepEqual(sub.read, { tools: ["kb_search", "kb_read"] });
  assert.equal(sub.write, undefined);
  assert.doesNotMatch(JSON.stringify(sub), /kb_write/);
});

test("kb_read without an entry returns a small store whole but caps a large one", async () => {
  const { leaf, store } = kb();
  store.append({
    target: "long_term",
    title: "Small",
    content: "tiny fact",
    sessionId: "s",
  });

  const small = await call(leaf, "kb_read", {});
  assert.match(small.text, /### Small\ntiny fact/);
  assert.match(small.text, /Files: `MEMORY\.md`/);

  store.append({
    target: "long_term",
    title: "Bulk",
    content: "x".repeat(5000),
    sessionId: "s",
  });

  const large = await call(leaf, "kb_read", {});
  assert.doesNotMatch(large.text, /xxxx/);
  assert.match(large.text, /Contents \(newest first\):/);
  assert.match(large.text, /Files: `MEMORY\.md`/);
});

test("kb_read fetches entries by id and answers an unknown id with the contents", async () => {
  const { leaf, store } = kb();
  store.append({
    target: "long_term",
    title: "Alpha",
    content: "first",
    sessionId: "s",
  });
  store.append({
    target: "long_term",
    title: "Beta",
    content: "second",
    sessionId: "s",
  });
  const [alpha, beta] = parseEntries(store.readMemory(), "stamped");

  const hit = await call(
    leaf,
    "kb_read",
    { entry: `${beta.id}, nope00` },
    "subagent",
  );
  assert.equal(hit.error, undefined);
  assert.match(hit.text, /### Beta\nsecond/);
  assert.doesNotMatch(hit.text, /first/);
  assert.match(hit.text, /Not found: `nope00`/);

  const miss = await call(leaf, "kb_read", { entry: "nope00" });
  assert.equal(miss.error, true);
  assert.match(miss.text, /Current contents/);
  assert.ok(miss.text.includes(`\`${alpha.id}\` Alpha`));
});
