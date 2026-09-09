import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root + global memory dir at throwaway dirs before importing
// modules that read config at load time, so writes never touch the repo.
const ROOT = mkdtempSync(path.join(tmpdir(), "host-res-"));
const MEM = mkdtempSync(path.join(tmpdir(), "host-mem-"));
process.env.SESSIONS_ROOT = ROOT;
process.env.GLOBAL_MEMORY_DIR = MEM;

const { applyResourceInput, memoryScopeFromUri, removeResourceByUri } =
  await import("./hostResources.ts");
const { ResourceCatalog } = await import("./resourceCatalog.ts");
const { MemoryManager } = await import("../pi/memory.ts");
const { HostResourcePreamble } = await import("../pi/hostResourcePreamble.ts");
const { InMemoryResourceStore } =
  await import("../store/inMemoryResourceStore.ts");
const { MEMORY_AUTHOR } = await import("@tangent/shared/contracts.ts");

import type { SessionStore } from "../store/sessionStore.ts";

// No roster rows, so `orchestratorConversationFor` resolves to the default
// "prime" conversation — enough for the catalog to reference into.
const store = { listAgents: async () => [] } as unknown as SessionStore;

after(() => {
  rmSync(ROOT, { recursive: true, force: true });
  rmSync(MEM, { recursive: true, force: true });
});

function deps() {
  const catalog = new ResourceCatalog(new InMemoryResourceStore());
  return { store, memory: new MemoryManager(), catalog };
}

function sessionRoot() {
  return mkdtempSync(path.join(ROOT, "s-"));
}

test("memoryScopeFromUri maps the memory uris and nothing else", () => {
  assert.equal(memoryScopeFromUri("memory://session"), "session");
  assert.equal(memoryScopeFromUri("memory://global"), "global");
  assert.equal(memoryScopeFromUri("https://x/pipelines/1"), null);
});

test("a memory input writes MEMORY.md and catalogs memory://session", async () => {
  const d = deps();
  const rootPath = sessionRoot();

  const resource = await applyResourceInput(d, "sess1", rootPath, {
    kind: "memory",
    scope: "session",
    content: "Prefer concise plans.",
  });

  assert.equal(resource.kind, "memory");
  assert.equal(resource.uri, "memory://session");
  assert.equal(resource.name, "Session memory");
  assert.equal(resource.authorParticipantId, MEMORY_AUTHOR.id);

  const file = readFileSync(path.join(rootPath, "MEMORY.md"), "utf8");
  assert.match(file, /Prefer concise plans\./);

  const listed = await d.catalog.listForSession("sess1");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].uri, "memory://session");
});

test("a host input catalogs a host row carrying its free-form meta", async () => {
  const d = deps();
  const rootPath = sessionRoot();

  const resource = await applyResourceInput(
    d,
    "sess2",
    rootPath,
    {
      kind: "host",
      name: "Orders pipeline",
      uri: "https://tangent.example/pipelines/orders",
      meta: {
        url: "https://tangent.example/pipelines/orders",
        description: "Ingests orders and flags anomalies.",
      },
    },
    "ben@example.com",
  );

  assert.equal(resource.kind, "host");
  assert.equal(resource.name, "Orders pipeline");
  assert.equal(resource.authorParticipantId, "ben@example.com");
  assert.deepEqual(resource.meta, {
    url: "https://tangent.example/pipelines/orders",
    description: "Ingests orders and flags anomalies.",
  });
});

test("re-adding the same host uri upserts rather than duplicating", async () => {
  const d = deps();
  const rootPath = sessionRoot();
  const uri = "https://tangent.example/pipelines/orders";

  await applyResourceInput(d, "sess3", rootPath, {
    kind: "host",
    name: "Orders",
    uri,
  });
  await applyResourceInput(d, "sess3", rootPath, {
    kind: "host",
    name: "Orders (renamed)",
    uri,
  });

  const listed = await d.catalog.listForSession("sess3");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, "Orders (renamed)");
});

test("removing a host resource drops the row and leaves memory untouched", async () => {
  const d = deps();
  const rootPath = sessionRoot();
  const uri = "https://tangent.example/pipelines/orders";
  await applyResourceInput(d, "sess4", rootPath, {
    kind: "host",
    name: "Orders",
    uri,
  });

  await removeResourceByUri(d, "sess4", rootPath, uri);

  assert.equal((await d.catalog.listForSession("sess4")).length, 0);
});

test("seeded resources are visible to the spawn preambles before ensure", async () => {
  const d = deps();
  const rootPath = sessionRoot();
  await applyResourceInput(d, "sess6", rootPath, {
    kind: "memory",
    scope: "session",
    content: "Prefer concise plans.",
  });
  await applyResourceInput(d, "sess6", rootPath, {
    kind: "host",
    name: "Orders pipeline",
    uri: "https://tangent.example/orders",
    meta: { description: "Ingests orders." },
  });

  assert.match(d.memory.buildPreamble(rootPath), /Prefer concise plans\./);

  const preamble = new HostResourcePreamble(d.catalog);
  await preamble.refresh("sess6");
  const text = preamble.get("sess6");
  assert.match(text, /Orders pipeline/);
  assert.match(text, /https:\/\/tangent\.example\/orders/);
  assert.match(text, /Ingests orders\./);
});

test("removing a memory resource clears the store and drops the row", async () => {
  const d = deps();
  const rootPath = sessionRoot();
  await applyResourceInput(d, "sess5", rootPath, {
    kind: "memory",
    scope: "session",
    content: "remember-me-secret",
  });

  await removeResourceByUri(d, "sess5", rootPath, "memory://session");

  const file = readFileSync(path.join(rootPath, "MEMORY.md"), "utf8");
  assert.doesNotMatch(file, /remember-me-secret/);
  assert.equal((await d.catalog.listForSession("sess5")).length, 0);
});
