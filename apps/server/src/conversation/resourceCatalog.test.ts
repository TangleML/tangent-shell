import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { InMemoryResourceStore } from "../store/inMemoryResourceStore.ts";
import { ResourceCatalog } from "./resourceCatalog.ts";
import { catalogWorkspaceFiles } from "./workspaceFiles.ts";

const ROOTS: string[] = [];
after(() => {
  for (const root of ROOTS) rmSync(root, { recursive: true, force: true });
});

/** A session root with the given files written under it (paths relative to root). */
function workspace(files: Record<string, string>): {
  id: string;
  rootPath: string;
} {
  const rootPath = mkdtempSync(path.join(tmpdir(), "workspace-"));
  ROOTS.push(rootPath);
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(rootPath, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return { id: "s1", rootPath };
}

test("surfacedFor is default-permissive until a grant narrows it", async () => {
  const catalog = new ResourceCatalog(new InMemoryResourceStore());
  const a = await catalog.catalogIn("c1", {
    sessionId: "s1",
    kind: "artifact",
    name: "A",
    uri: "artifacts/a.html",
  });
  const b = await catalog.catalogIn("c1", {
    sessionId: "s1",
    kind: "artifact",
    name: "B",
    uri: "artifacts/b.html",
  });

  // No grants: the membership surfaces the whole reference set.
  const before = await catalog.surfacedFor("s1", "c1", "ben");
  assert.deepEqual(before.map((r) => r.id).sort(), [a.id, b.id].sort());

  // A grant to ben narrows ben's view to the granted subset only.
  await catalog.grant({
    sessionId: "s1",
    conversationId: "c1",
    participantId: "ben",
    resourceId: a.id,
  });
  const forBen = await catalog.surfacedFor("s1", "c1", "ben");
  assert.deepEqual(
    forBen.map((r) => r.id),
    [a.id],
  );

  // Another participant with no grants still sees everything (default-permissive).
  const forAna = await catalog.surfacedFor("s1", "c1", "ana");
  assert.equal(forAna.length, 2);
});

test("catalogWorkspaceFiles catalogs files without downgrading known kinds", async () => {
  const catalog = new ResourceCatalog(new InMemoryResourceStore());
  const session = workspace({
    "artifacts/report.html": "<h1>hi</h1>",
    "artifacts/nested/data.json": "{}",
    "uploads/notes.txt": "notes",
  });

  // A path already catalogued as an artifact must keep its kind after a scan.
  const pinned = await catalog.catalog({
    sessionId: session.id,
    kind: "artifact",
    name: "Report",
    uri: "artifacts/report.html",
  });

  await catalogWorkspaceFiles(catalog, session);

  const all = await catalog.listForSession(session.id);
  const byUri = new Map(all.map((r) => [r.uri, r]));
  assert.equal(byUri.get("artifacts/report.html")?.kind, "artifact");
  assert.equal(byUri.get("artifacts/report.html")?.id, pinned.id);
  assert.equal(byUri.get("artifacts/nested/data.json")?.kind, "file");
  assert.equal(byUri.get("uploads/notes.txt")?.kind, "file");
  assert.equal(all.length, 3);
});
