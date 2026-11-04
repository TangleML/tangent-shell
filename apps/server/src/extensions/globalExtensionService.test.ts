import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { FileExtensionStore } from "./fileExtensionStore.ts";
import {
  ExtensionConflictError,
  GlobalExtensionService,
} from "./globalExtensionService.ts";
import { MarketplaceRegistry } from "./marketplaces/registry.ts";
import type { ExtensionMarketplace } from "./types.ts";

const ROOT = mkdtempSync(path.join(tmpdir(), "ext-service-"));
after(() => rmSync(ROOT, { recursive: true, force: true }));

/** A marketplace that writes a minimal pi package, counting its installs. */
class FakeMarketplace implements ExtensionMarketplace {
  readonly id = "fake";
  installs = 0;
  fail = false;

  async install(ref: string, pkgDir: string): Promise<string> {
    this.installs += 1;
    if (this.fail) throw new Error("install boom");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: ref,
        version: "1.0.0",
        pi: { extensions: ["index.ts"] },
        tangent: { tools: ["fake_tool"] },
      }),
    );
    await writeFile(path.join(pkgDir, "index.ts"), "// fake extension");
    return pkgDir;
  }
}

/** Builds a service over a fresh temp store with one fake marketplace. */
function makeService(name: string): {
  service: GlobalExtensionService;
  store: FileExtensionStore;
  fake: FakeMarketplace;
} {
  const store = new FileExtensionStore(path.join(ROOT, name));
  const registry = new MarketplaceRegistry();
  const fake = new FakeMarketplace();
  registry.register(fake);
  return { service: new GlobalExtensionService(registry, store), store, fake };
}

test("installs from a source, recording resources, tools, and status", async () => {
  const { service, store } = makeService("install");

  const meta = await service.installFromSource("fake:my-ext");

  assert.equal(meta.id, "my-ext");
  assert.equal(meta.status, "ready");
  assert.deepEqual(meta.tools, ["fake_tool"]);
  assert.deepEqual(meta.resources.extensions, ["index.ts"]);
  assert.ok(existsSync(path.join(store.pkgDir("my-ext"), "index.ts")));
  assert.deepEqual(service.readyIds(), ["my-ext"]);
});

/** A real extension (no declared tools) that registers two tools on load. */
const PROBE_EXTENSION = `export default function (pi) {
  for (const name of ["alpha_tool", "beta_tool"]) {
    pi.registerTool({
      name,
      label: name,
      description: name,
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: [], details: {} }),
    });
  }
}
`;

/** A marketplace whose package declares no tools; `skillsOnly` ships no code. */
class UndeclaredMarketplace implements ExtensionMarketplace {
  readonly id = "undeclared";
  readonly skillsOnly: boolean;
  constructor(skillsOnly = false) {
    this.skillsOnly = skillsOnly;
  }

  async install(ref: string, pkgDir: string): Promise<string> {
    await mkdir(pkgDir, { recursive: true });
    const pi = this.skillsOnly
      ? { skills: ["SKILL.md"] }
      : { extensions: ["index.js"] };
    await writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: ref, version: "1.0.0", pi }),
    );
    if (this.skillsOnly) {
      await writeFile(path.join(pkgDir, "SKILL.md"), "# Notes");
    } else {
      await writeFile(path.join(pkgDir, "index.js"), PROBE_EXTENSION);
    }
    return pkgDir;
  }
}

test("probes and records an extension's own registered tools", async (t) => {
  const store = new FileExtensionStore(path.join(ROOT, "undeclared"));
  const registry = new MarketplaceRegistry();
  registry.register(new UndeclaredMarketplace());
  const service = new GlobalExtensionService(registry, store);

  const meta = await service.installFromSource("undeclared:web");
  if (meta.tools.length === 1 && meta.tools[0] === "*") {
    t.skip("pi binary not resolvable; probe fell back to wildcard");
    return;
  }
  assert.deepEqual([...meta.tools].sort(), ["alpha_tool", "beta_tool"]);
  assert.deepEqual(service.spawnPlan(["web"]).allowlistTools, meta.tools);
});

test("records no tools for a skills-only package", async () => {
  const store = new FileExtensionStore(path.join(ROOT, "skills-only"));
  const registry = new MarketplaceRegistry();
  registry.register(new UndeclaredMarketplace(true));
  const service = new GlobalExtensionService(registry, store);

  const meta = await service.installFromSource("undeclared:notes");
  assert.deepEqual(meta.tools, []);
});

test("rejects a duplicate install unless replace is set", async () => {
  const { service } = makeService("conflict");
  await service.installFromSource("fake:dup");

  await assert.rejects(
    service.installFromSource("fake:dup"),
    (err: unknown) => err instanceof ExtensionConflictError,
  );

  const replaced = await service.installFromSource("fake:dup", {
    replace: true,
  });
  assert.equal(replaced.id, "dup");
});

test("spawnPlan skips unknown and errored ids, deduping the rest", async () => {
  const { service } = makeService("spawn");
  await service.installFromSource("fake:good");

  const plan = service.spawnPlan(["good", "good", "missing"]);
  assert.equal(plan.extensionPaths.length, 1);
  assert.ok(
    plan.extensionPaths[0].endsWith(path.join("good", "pkg", "index.ts")),
  );
  assert.deepEqual(plan.allowlistTools, ["fake_tool"]);
});

test("reconcile reinstalls an extension whose package files went missing", async () => {
  const { service, store, fake } = makeService("reconcile");
  await service.installFromSource("fake:survivor");
  assert.equal(fake.installs, 1);

  await rm(store.pkgDir("survivor"), { recursive: true, force: true });
  assert.ok(!existsSync(path.join(store.pkgDir("survivor"), "index.ts")));

  const reinstalled = await service.reconcile();
  assert.equal(reinstalled, 1);
  assert.equal(fake.installs, 2);
  assert.ok(existsSync(path.join(store.pkgDir("survivor"), "index.ts")));
  assert.deepEqual(service.readyIds(), ["survivor"]);
});

test("reconcile marks an install errored when its reinstall fails", async () => {
  const { service, store, fake } = makeService("reconcile-fail");
  await service.installFromSource("fake:fragile");
  await rm(store.pkgDir("fragile"), { recursive: true, force: true });

  fake.fail = true;
  const reinstalled = await service.reconcile();

  assert.equal(reinstalled, 0);
  assert.deepEqual(service.readyIds(), []);
  assert.equal(service.list()[0]?.status, "error");
  assert.equal(service.spawnPlan(["fragile"]).extensionPaths.length, 0);
});

test("uninstall removes an install and clears it from the cache", async () => {
  const { service, store } = makeService("uninstall");
  await service.installFromSource("fake:temp");

  assert.equal(await service.uninstall("temp"), true);
  assert.equal(await service.uninstall("temp"), false);
  assert.equal(service.list().length, 0);
  assert.ok(!existsSync(store.dir("temp")));
});
