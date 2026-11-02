import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  GlobalExtensionMeta,
  GlobalExtensionResources,
  MarketplaceListing,
} from "@tangent/shared/contracts.ts";

import {
  FileExtensionStore,
  isUnsafeId,
  PKG_DIRNAME,
  SOURCE_DIRNAME,
} from "./fileExtensionStore.ts";
import type { MarketplaceRegistry } from "./marketplaces/registry.ts";
import {
  declaredTools,
  readPackageManifest,
  resolvePackageResources,
} from "./packageResources.ts";
import { probeExtensionTools } from "./probeTools.ts";
import type { ExtensionMarketplace, ExtensionSpawnPlan } from "./types.ts";

/** Raised when an install id already exists and the caller didn't opt to replace. */
export class ExtensionConflictError extends Error {}

/** Raised when a source, upload, or installed package is invalid. */
export class ExtensionValidationError extends Error {}

/** Normalized inputs to an install run, from a source string or an upload. */
interface InstallRun {
  marketplace: ExtensionMarketplace;
  /** Install ref the marketplace understands (npm spec, git url, or filename). */
  ref: string;
  /** Preserved-upload bytes for a `file` source. */
  upload?: { filename: string; data: Buffer };
  /** An existing preserved-source file to reinstall from (reconcile path). */
  sourcePath?: string;
  idOverride?: string;
  tools?: string[];
  replace: boolean;
  /** First-install timestamp to preserve across a reinstall. */
  installedAt?: string;
}

/** Options shared by the public install entry points. */
export interface InstallOptions {
  id?: string;
  tools?: string[];
  replace?: boolean;
}

/**
 * Lowercases and slugs a package name into a storage id: a scoped name
 * (`@scope/foo`) becomes `scope-foo`, every other invalid run collapses to a
 * single `-`, and leading/trailing dashes are trimmed.
 */
export function slugifyExtensionId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug;
}

/** A parsed package manifest (or `undefined` when the package carries none). */
type Manifest = Awaited<ReturnType<typeof readPackageManifest>>;

/** Rejects a package that contributes no Pi resources. */
function assertHasResources(resources: GlobalExtensionResources): void {
  if (
    resources.extensions.length === 0 &&
    resources.skills.length === 0 &&
    resources.prompts.length === 0
  ) {
    throw new ExtensionValidationError(
      "package declares no extensions, skills, or prompts",
    );
  }
}

/** Whether an id is a safe, single-segment slug. */
function isValidId(id: string): boolean {
  return !isUnsafeId(id) && /^[a-z0-9][a-z0-9-]*$/.test(id);
}

/** The storage id for an install: an override, the package name, or the ref. */
function resolveInstallId(run: InstallRun, manifest: Manifest): string {
  const id = slugifyExtensionId(run.idOverride ?? manifest?.name ?? run.ref);
  if (!isValidId(id)) {
    throw new ExtensionValidationError(`invalid extension id "${id}"`);
  }
  return id;
}

/** The package root relative to `pkgDir`, as a POSIX path (`.` when equal). */
function packageRootOf(pkgDir: string, root: string): string {
  return path.relative(pkgDir, root).split(path.sep).join("/") || ".";
}

/** The install timestamp to keep: an explicit override, a prior install, or now. */
function firstInstalledAt(
  run: InstallRun,
  existing: GlobalExtensionMeta | undefined,
  now: string,
): string {
  return run.installedAt ?? existing?.installedAt ?? now;
}

/** Absolute paths of a package's resolved extension entries. */
function absExtensionPaths(
  root: string,
  resources: GlobalExtensionResources,
): string[] {
  return resources.extensions.map((rel) => path.join(root, rel));
}

/**
 * The tool allowlist to record for an install. An explicit list (admin-chosen,
 * or carried across a reinstall) wins, then the package's declared tools
 * (`tangent.tools` / `pi.tools`). Otherwise the extension is loaded in a
 * subprocess to enumerate exactly the tools it registers, so opting in grants
 * those and nothing more (an empty result means it registers none). Only when
 * the probe can't run at all does a package that ships extension code fall back
 * to `*`; a skills/prompts-only package records none.
 */
async function resolveInstallTools(
  run: InstallRun,
  manifest: Manifest,
  resources: GlobalExtensionResources,
  root: string,
): Promise<string[]> {
  if (run.tools) return run.tools;
  const declared = declaredTools(manifest);
  if (declared.length > 0) return declared;
  if (resources.extensions.length === 0) return [];
  const probed = await probeExtensionTools(
    absExtensionPaths(root, resources),
    root,
  );
  return probed ?? ["*"];
}

/** Inputs to {@link buildMeta}. */
interface BuildMetaArgs {
  run: InstallRun;
  id: string;
  manifest: Manifest;
  resources: GlobalExtensionResources;
  tools: string[];
  pkgDir: string;
  root: string;
  existing: GlobalExtensionMeta | undefined;
}

/** Assembles the persisted metadata for a freshly staged install. */
function buildMeta(args: BuildMetaArgs): GlobalExtensionMeta {
  const { run, id, manifest, resources, tools, pkgDir, root, existing } = args;
  const now = new Date().toISOString();
  return {
    id,
    name: manifest?.name ?? id,
    version: manifest?.version,
    source: { marketplace: run.marketplace.id, ref: run.ref },
    tools,
    resources,
    packageRoot: packageRootOf(pkgDir, root),
    installedAt: firstInstalledAt(run, existing, now),
    updatedAt: now,
    status: "ready",
  };
}

/**
 * Owns the global extension registry: installs from a {@link
 * MarketplaceRegistry}, persists through a {@link FileExtensionStore}, and
 * projects the installed set onto a Pi spawn. An in-memory cache keeps {@link
 * GlobalExtensionService.spawnPlan} synchronous (the agent manager calls it on
 * the hot spawn path) and {@link GlobalExtensionService.reconcile} seeds it at
 * boot, reinstalling anything the volume is missing so an install survives a
 * pod restart.
 */
export class GlobalExtensionService {
  private readonly registry: MarketplaceRegistry;
  private readonly store: FileExtensionStore;
  private readonly cache = new Map<string, GlobalExtensionMeta>();

  constructor(registry: MarketplaceRegistry, store: FileExtensionStore) {
    this.registry = registry;
    this.store = store;
  }

  /** Installs from a `"<marketplace>:<ref>"` source (npm/git). */
  async installFromSource(
    source: string,
    options: InstallOptions = {},
  ): Promise<GlobalExtensionMeta> {
    const { marketplace, ref } = this.registry.parseSource(source);
    return this.runInstall({
      marketplace,
      ref,
      idOverride: options.id,
      tools: options.tools,
      replace: options.replace ?? false,
    });
  }

  /** Installs from an uploaded file (the `file` marketplace). */
  async installFromUpload(
    filename: string,
    data: Buffer,
    options: InstallOptions = {},
  ): Promise<GlobalExtensionMeta> {
    const marketplace = this.registry.get("file");
    if (!marketplace) {
      throw new ExtensionValidationError("file marketplace is not registered");
    }
    return this.runInstall({
      marketplace,
      ref: filename,
      upload: { filename, data },
      idOverride: options.id,
      tools: options.tools,
      replace: options.replace ?? false,
    });
  }

  /** Removes an installed extension. Returns `false` when it was unknown. */
  async uninstall(id: string): Promise<boolean> {
    const deleted = await this.store.delete(id);
    if (deleted) this.cache.delete(id);
    return deleted;
  }

  /** Patches an install's tool allowlist and/or display name in place. */
  async update(
    id: string,
    patch: { tools?: string[]; name?: string },
  ): Promise<GlobalExtensionMeta | undefined> {
    const existing = this.cache.get(id) ?? (await this.store.get(id));
    if (!existing) return undefined;
    const next: GlobalExtensionMeta = {
      ...existing,
      tools: patch.tools ?? existing.tools,
      name: patch.name ?? existing.name,
      updatedAt: new Date().toISOString(),
    };
    await this.store.writeMeta(this.store.dir(id), next);
    this.cache.set(id, next);
    return next;
  }

  /** The installed extensions, newest status first reflected from the cache. */
  list(): GlobalExtensionMeta[] {
    return [...this.cache.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** The ids of every extension currently healthy enough to spawn. */
  readyIds(): string[] {
    return this.list()
      .filter((meta) => meta.status === "ready")
      .map((meta) => meta.id);
  }

  /** The marketplaces available for install/search (id + search support). */
  marketplaces(): { id: string; canSearch: boolean }[] {
    return this.registry.list().map((marketplace) => ({
      id: marketplace.id,
      canSearch: typeof marketplace.search === "function",
    }));
  }

  /** Searches one marketplace, or `undefined` when it has no search support. */
  async search(
    marketplaceId: string,
    query: string,
  ): Promise<MarketplaceListing[] | undefined> {
    const marketplace = this.registry.get(marketplaceId);
    if (!marketplace?.search) return undefined;
    return marketplace.search(query);
  }

  /**
   * Loads the persisted installs into the cache and reinstalls any whose
   * resource files are missing from the volume (e.g. a fresh pod with a reused
   * data volume, or an interrupted write). Never throws: a failed reinstall is
   * logged and the install is kept as `error` so a later retry can recover it.
   * Returns how many were reinstalled.
   */
  async reconcile(): Promise<number> {
    this.cache.clear();
    const metas = await this.store.list();
    let reinstalled = 0;
    for (const meta of metas) {
      this.cache.set(meta.id, meta);
      if (this.resourcesPresent(meta)) {
        this.setStatus(meta.id, "ready");
        continue;
      }
      const recovered = await this.tryReinstall(meta);
      if (recovered) reinstalled += 1;
    }
    return reinstalled;
  }

  /**
   * The spawn plan for a resolved set of extension ids: the absolute resource
   * paths and tool allowlist to fold into a Pi spawn. Unknown or errored ids are
   * skipped with a warning so one bad install never blocks a session.
   */
  spawnPlan(ids: string[]): ExtensionSpawnPlan {
    const plan: ExtensionSpawnPlan = {
      extensionPaths: [],
      skillPaths: [],
      promptPaths: [],
      allowlistTools: [],
    };
    for (const id of ids) {
      const meta = this.cache.get(id);
      if (!meta) {
        console.warn(
          `[extensions] session references unknown extension "${id}"`,
        );
        continue;
      }
      if (meta.status !== "ready") {
        console.warn(`[extensions] skipping "${id}" (status: ${meta.status})`);
        continue;
      }
      const abs = this.resolveAbsResources(meta);
      plan.extensionPaths.push(...abs.extensions);
      plan.skillPaths.push(...abs.skills);
      plan.promptPaths.push(...abs.prompts);
      plan.allowlistTools.push(...meta.tools);
    }
    return {
      extensionPaths: [...new Set(plan.extensionPaths)],
      skillPaths: [...new Set(plan.skillPaths)],
      promptPaths: [...new Set(plan.promptPaths)],
      allowlistTools: [...new Set(plan.allowlistTools)],
    };
  }

  /** The absolute package root for an install (`pkg/` joined with packageRoot). */
  private packageRootDir(meta: GlobalExtensionMeta): string {
    const base = this.store.pkgDir(meta.id);
    return meta.packageRoot === "."
      ? base
      : path.join(base, ...meta.packageRoot.split("/"));
  }

  /** Resolves an install's package-relative resources to absolute paths. */
  private resolveAbsResources(meta: GlobalExtensionMeta): {
    extensions: string[];
    skills: string[];
    prompts: string[];
  } {
    const root = this.packageRootDir(meta);
    const toAbs = (rel: string) =>
      rel === "." ? root : path.join(root, ...rel.split("/"));
    return {
      extensions: meta.resources.extensions.map(toAbs),
      skills: meta.resources.skills.map(toAbs),
      prompts: meta.resources.prompts.map(toAbs),
    };
  }

  /** Whether every resolved resource path for an install exists on disk. */
  private resourcesPresent(meta: GlobalExtensionMeta): boolean {
    const abs = this.resolveAbsResources(meta);
    return [...abs.extensions, ...abs.skills, ...abs.prompts].every((p) =>
      existsSync(p),
    );
  }

  /** Reinstalls a missing install from its recorded source; `false` on failure. */
  private async tryReinstall(meta: GlobalExtensionMeta): Promise<boolean> {
    const marketplace = this.registry.get(meta.source.marketplace);
    if (!marketplace) {
      this.markError(
        meta.id,
        `unknown marketplace "${meta.source.marketplace}"`,
      );
      return false;
    }
    const resolved = await this.reinstallSourcePath(meta);
    if (resolved.error) {
      this.markError(meta.id, resolved.error);
      return false;
    }
    return this.runReinstall(meta, marketplace, resolved.sourcePath);
  }

  /** The preserved `file` upload to reinstall from (none for fetched sources). */
  private async reinstallSourcePath(
    meta: GlobalExtensionMeta,
  ): Promise<{ sourcePath?: string; error?: string }> {
    if (meta.source.marketplace !== "file") return {};
    const sourcePath = await this.store.sourceFile(meta.id);
    if (!sourcePath) return { error: "preserved source upload is missing" };
    return { sourcePath };
  }

  /** Runs a recovery reinstall, keeping the install `error` on failure. */
  private async runReinstall(
    meta: GlobalExtensionMeta,
    marketplace: ExtensionMarketplace,
    sourcePath: string | undefined,
  ): Promise<boolean> {
    try {
      await this.runInstall({
        marketplace,
        ref: meta.source.ref,
        sourcePath,
        idOverride: meta.id,
        tools: meta.tools,
        replace: true,
        installedAt: meta.installedAt,
      });
      console.log(`[extensions] reinstalled "${meta.id}"`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.markError(meta.id, message);
      console.error(
        `[extensions] failed to reinstall "${meta.id}": ${message}`,
      );
      return false;
    }
  }

  /** Overlays a runtime status onto the cached meta (no disk write). */
  private setStatus(id: string, status: "ready" | "error"): void {
    const meta = this.cache.get(id);
    if (meta) this.cache.set(id, { ...meta, status, error: undefined });
  }

  /** Marks a cached install `error` with a reason. */
  private markError(id: string, error: string): void {
    const meta = this.cache.get(id);
    if (meta) this.cache.set(id, { ...meta, status: "error", error });
  }

  /** Installs into a staging dir, validates, and swaps it in atomically. */
  private async runInstall(run: InstallRun): Promise<GlobalExtensionMeta> {
    const staging = await this.store.makeStaging();
    try {
      const meta = await this.installIntoStaging(staging, run);
      await this.store.commit(staging, meta.id);
      this.cache.set(meta.id, meta);
      return meta;
    } catch (err) {
      await this.store.discard(staging);
      throw err;
    }
  }

  /** Installs and validates into the staging dir, returning its metadata. */
  private async installIntoStaging(
    staging: string,
    run: InstallRun,
  ): Promise<GlobalExtensionMeta> {
    const pkgDir = path.join(staging, PKG_DIRNAME);
    const sourcePath = await this.stageSource(staging, run);
    const root = await run.marketplace.install(run.ref, pkgDir, { sourcePath });

    const resources = await resolvePackageResources(root);
    assertHasResources(resources);

    const manifest = await readPackageManifest(root);
    const id = resolveInstallId(run, manifest);
    const existing = this.cache.get(id) ?? (await this.store.get(id));
    if (existing && !run.replace) {
      throw new ExtensionConflictError(
        `extension "${id}" is already installed`,
      );
    }

    const tools = await resolveInstallTools(run, manifest, resources, root);
    const meta = buildMeta({
      run,
      id,
      manifest,
      resources,
      tools,
      pkgDir,
      root,
      existing,
    });
    await this.store.writeMeta(staging, meta);
    return meta;
  }

  /** Writes the upload (or copies an existing source) into the staging `source/`. */
  private async stageSource(
    staging: string,
    run: InstallRun,
  ): Promise<string | undefined> {
    if (!run.upload && !run.sourcePath) return undefined;
    const dir = path.join(staging, SOURCE_DIRNAME);
    await mkdir(dir, { recursive: true });
    if (run.upload) {
      const dest = path.join(dir, path.basename(run.upload.filename));
      await writeFile(dest, run.upload.data);
      return dest;
    }
    const dest = path.join(dir, path.basename(run.sourcePath as string));
    await copyFile(run.sourcePath as string, dest);
    return dest;
  }
}
