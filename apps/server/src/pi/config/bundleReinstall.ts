import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  BUNDLE_DIRS,
  type BundleManifest,
  MANIFEST_FILENAME,
  RULES_FILENAME,
} from "@tangent/shared/configBundle.ts";

import {
  ARTIFACTS_DIRNAME,
  GLOBAL_MEMORY_FILENAME,
  SESSION_MEMORY_FILENAME,
  UPLOADS_DIRNAME,
} from "../../config.ts";
import type { ResolvedSessionConfig } from "../agentConfig.ts";
import {
  INSTALL_RECORD_FILENAME,
  installBundle,
  type InstallRecord,
  loadInstalledConfig,
  RUNTIME_TANGENT_ENTRIES,
  TANGENT_DIRNAME,
} from "./bundleLoader.ts";
import { parseManifest } from "./manifest.ts";

/** Prefix of the scratch root a reinstall stages into, inside the session root
 * so the final swap is a same-filesystem rename. */
const STAGING_PREFIX = ".tangent-staging-";

/**
 * Session-root names a bundle may never own: memory, the served subtrees and
 * the install itself. A reinstall neither writes nor moves them, whatever an
 * install record claims.
 */
const RESERVED_ROOT_NAMES: ReadonlySet<string> = new Set([
  ARTIFACTS_DIRNAME,
  UPLOADS_DIRNAME,
  TANGENT_DIRNAME,
  SESSION_MEMORY_FILENAME,
  GLOBAL_MEMORY_FILENAME,
]);

/**
 * Raised when a new bundle would write a session-root path the session owns:
 * a reserved name, or an existing file, folder or mount the previous install
 * did not write. Checked before anything moves.
 */
export class BundleRootConflictError extends Error {
  constructor(names: string[]) {
    super(
      `bundle: it would overwrite session files it does not own: ${names.join(", ")}. ` +
        "Rename these context or memory files in the bundle.",
    );
    this.name = "BundleRootConflictError";
  }
}

/** A bundle fully installed into a scratch root, not yet live. */
export interface StagedBundle {
  manifest: BundleManifest;
  /** Swaps the staged files into the session root and resolves the live config. */
  commit(): Promise<ResolvedSessionConfig>;
  discard(): Promise<void>;
}

/**
 * Installs a bundle into a scratch root inside `rootPath` (including the trigger
 * compile), so an invalid bundle fails here and leaves the live session alone.
 */
export async function stageBundle(
  zipBuffer: Buffer,
  rootPath: string,
): Promise<StagedBundle> {
  await removeStaleStaging(rootPath);
  const stagingRoot = await mkdtemp(path.join(rootPath, STAGING_PREFIX));
  const discard = () => rm(stagingRoot, { recursive: true, force: true });
  try {
    const { manifest } = await installBundle(zipBuffer, stagingRoot);
    assertNoRootConflicts(stagingRoot, rootPath);
    return {
      manifest,
      commit: () => commitStaged(stagingRoot, rootPath),
      discard,
    };
  } catch (err) {
    await discard();
    throw err;
  }
}

async function removeStaleStaging(rootPath: string): Promise<void> {
  for (const name of readdirSync(rootPath)) {
    if (!name.startsWith(STAGING_PREFIX)) continue;
    await rm(path.join(rootPath, name), { recursive: true, force: true });
  }
}

/** Renames that can be reversed if a later step of the swap fails. */
class SwapJournal {
  private readonly done: { from: string; to: string }[] = [];

  async move(from: string, to: string): Promise<void> {
    if (!existsSync(from)) return;
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
    this.done.push({ from, to });
  }

  async undo(): Promise<void> {
    for (const { from, to } of this.done.reverse()) {
      await rename(to, from).catch((err: unknown) =>
        console.error(`[bundle] failed to roll back ${from}:`, err),
      );
    }
  }
}

/** Where a commit moves things: the live root, the staged root, and the
 * scratch dir displaced entries go to (removed with the staging root). */
interface SwapPaths {
  rootPath: string;
  stagingRoot: string;
  live: string;
  staged: string;
  replaced: string;
}

/**
 * Replaces only what the previous install owned with what the new one owns:
 * each owned top-level `.tangent/` entry and workspace-root bundle file is
 * moved aside and the staged copy renamed in. `.tangent/` itself never moves,
 * so runtime entries (chats, triggers) stay put and keep receiving writes. Seed
 * memory files are only added when missing; the session owns them after create.
 */
async function commitStaged(
  stagingRoot: string,
  rootPath: string,
): Promise<ResolvedSessionConfig> {
  const paths: SwapPaths = {
    rootPath,
    stagingRoot,
    live: path.join(rootPath, TANGENT_DIRNAME),
    staged: path.join(stagingRoot, TANGENT_DIRNAME),
    replaced: path.join(stagingRoot, ".replaced"),
  };
  const { previous, next } = assertNoRootConflicts(stagingRoot, rootPath);

  const journal = new SwapJournal();
  try {
    await swapTangentEntries(journal, paths, previous, next);
    await swapRootFiles(journal, paths, previous, next);
    await addMissingSeeds(journal, paths, next);
  } catch (err) {
    await journal.undo();
    throw err;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }

  const config = loadInstalledConfig(rootPath);
  if (!config) throw new Error("bundle: reinstalled config did not resolve");
  return config;
}

async function swapTangentEntries(
  journal: SwapJournal,
  { live, staged, replaced }: SwapPaths,
  previous: InstallRecord,
  next: InstallRecord,
): Promise<void> {
  await mkdir(live, { recursive: true });
  const names = [
    ...union(previous.tangentEntries, next.tangentEntries),
    INSTALL_RECORD_FILENAME,
  ];
  for (const name of names) {
    await journal.move(path.join(live, name), path.join(replaced, "t", name));
    await journal.move(path.join(staged, name), path.join(live, name));
  }
}

async function swapRootFiles(
  journal: SwapJournal,
  { rootPath, stagingRoot, replaced }: SwapPaths,
  previous: InstallRecord,
  next: InstallRecord,
): Promise<void> {
  for (const name of union(previous.rootFiles, next.rootFiles)) {
    await journal.move(
      path.join(rootPath, name),
      path.join(replaced, "r", name),
    );
    if (!next.rootFiles.includes(name)) continue;
    await journal.move(path.join(stagingRoot, name), path.join(rootPath, name));
  }
}

async function addMissingSeeds(
  journal: SwapJournal,
  { rootPath, stagingRoot }: SwapPaths,
  next: InstallRecord,
): Promise<void> {
  for (const name of next.seedFiles) {
    if (existsSync(path.join(rootPath, name))) continue;
    await journal.move(path.join(stagingRoot, name), path.join(rootPath, name));
  }
}

function isReservedRootName(name: string): boolean {
  return RESERVED_ROOT_NAMES.has(name) || name.startsWith(STAGING_PREFIX);
}

/** Whether anything (including a dangling mount symlink) sits at `abs`. */
function pathTaken(abs: string): boolean {
  try {
    lstatSync(abs);
    return true;
  } catch {
    return false;
  }
}

/** The previous install's record, with reserved root names never treated as owned. */
function previousInstallRecord(live: string): InstallRecord {
  const record = readInstallRecord(live) ?? legacyInstallRecord(live);
  return {
    ...record,
    rootFiles: record.rootFiles.filter((name) => !isReservedRootName(name)),
  };
}

/**
 * Reads both install records and refuses, before anything moves, a new bundle
 * whose root files would land on a reserved name or replace an existing path
 * the previous install did not write. Seeds need no check: they are only ever
 * added where nothing exists.
 */
function assertNoRootConflicts(
  stagingRoot: string,
  rootPath: string,
): { previous: InstallRecord; next: InstallRecord } {
  const next = readInstallRecord(path.join(stagingRoot, TANGENT_DIRNAME));
  if (!next) throw new Error("bundle: staged install is missing its record");
  const previous = previousInstallRecord(path.join(rootPath, TANGENT_DIRNAME));

  const owned = new Set(previous.rootFiles);
  const conflicts = union(
    next.rootFiles.filter(isReservedRootName),
    next.rootFiles.filter(
      (name) => !owned.has(name) && pathTaken(path.join(rootPath, name)),
    ),
  );
  if (conflicts.length > 0) throw new BundleRootConflictError(conflicts);
  return { previous, next };
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

/** A safe single path segment (record names are joined onto real roots). */
function isSafeName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !/[/\\]/.test(name)
  );
}

function safeNames(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isSafeName) : [];
}

function readInstallRecord(tangentDir: string): InstallRecord | undefined {
  const file = path.join(tangentDir, INSTALL_RECORD_FILENAME);
  if (!existsSync(file)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    return {
      tangentEntries: safeNames(raw.tangentEntries).filter(
        (name) => !RUNTIME_TANGENT_ENTRIES.has(name),
      ),
      rootFiles: safeNames(raw.rootFiles),
      seedFiles: safeNames(raw.seedFiles),
    };
  } catch {
    return undefined;
  }
}

/**
 * What an install that predates {@link INSTALL_RECORD_FILENAME} owns: every
 * `.tangent/` entry but the runtime ones, plus the rules file and the context
 * files the installed manifest declares.
 */
function legacyInstallRecord(tangentDir: string): InstallRecord {
  if (!existsSync(tangentDir)) {
    return { tangentEntries: [], rootFiles: [], seedFiles: [] };
  }
  const tangentEntries = readdirSync(tangentDir).filter(
    (name) =>
      !RUNTIME_TANGENT_ENTRIES.has(name) && name !== INSTALL_RECORD_FILENAME,
  );
  return {
    tangentEntries,
    rootFiles: safeNames(legacyRootFiles(tangentDir)),
    seedFiles: [],
  };
}

function legacyRootFiles(tangentDir: string): string[] {
  const rules = existsSync(
    path.join(tangentDir, BUNDLE_DIRS.rules, RULES_FILENAME),
  )
    ? [RULES_FILENAME]
    : [];
  const manifestFile = path.join(tangentDir, MANIFEST_FILENAME);
  if (!existsSync(manifestFile)) return rules;
  const parsed = parseManifest(readFileSync(manifestFile, "utf8"));
  if (!("manifest" in parsed)) return rules;
  const context = (parsed.manifest.contextFiles ?? []).map((rel) =>
    path.posix.basename(rel),
  );
  return [...rules, ...context];
}
