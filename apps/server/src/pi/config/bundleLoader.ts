import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  BUNDLE_DIRS,
  type BundleManifest,
  MANIFEST_FILENAME,
  RULES_FILENAME,
} from "@tangent/shared/configBundle.ts";
import { build } from "esbuild";
import { unzipSync } from "fflate";

import {
  buildTemplatesFromDir,
  composePrimePrompt,
  DEFAULT_TOOLS,
  PRIME_MEMORY_TOOLS,
  PRIME_ORCHESTRATION_TOOLS,
  PRIME_SESSION_TOOLS,
  PRIME_TRIGGER_TOOLS,
  type ResolvedSessionConfig,
  SHARED_AGENT_TOOLS,
  type SubagentDefaults,
} from "../agentConfig.ts";
import { parseManifest } from "./manifest.ts";

/** Subdirectory under a session root that holds its installed bundle config. */
export const TANGENT_DIRNAME = ".tangent";

/** Result of {@link installBundle}: the parsed manifest and resolved config. */
export interface InstalledBundle {
  manifest: BundleManifest;
  config: ResolvedSessionConfig;
}

/** Decoded ZIP entries, keyed by their POSIX-relative path. */
type ZipEntries = Record<string, Uint8Array>;

const decoder = new TextDecoder();

/**
 * A bundle-relative entry path is safe when it is a non-empty relative POSIX
 * path with no `..` traversal and no absolute/drive prefix. Mirrors the shape
 * guard in `manifest.ts`; here it guards every entry extracted from the ZIP so
 * a malicious archive can't write outside the session root.
 */
function isSafeEntryPath(value: string): boolean {
  if (value.length === 0) return false;
  if (value.startsWith("/") || /^[a-zA-Z]:/.test(value)) return false;
  return value
    .split("/")
    .every((segment) => segment !== ".." && segment !== "");
}

/** Unzips the buffer, rejecting any path-traversal or directory entries. */
function readZipEntries(zipBuffer: Buffer): ZipEntries {
  const raw = unzipSync(new Uint8Array(zipBuffer));
  const entries: ZipEntries = {};
  for (const [name, data] of Object.entries(raw)) {
    // Directory entries (trailing slash, empty payload) carry no content.
    if (name.endsWith("/")) continue;
    if (!isSafeEntryPath(name)) {
      throw new Error(`bundle: unsafe entry path "${name}"`);
    }
    entries[name] = data;
  }
  return entries;
}

/** Reads a required text entry, throwing a descriptive error when missing. */
function readTextEntry(entries: ZipEntries, rel: string): string {
  const data = entries[rel];
  if (!data) throw new Error(`bundle: missing file "${rel}"`);
  return decoder.decode(data);
}

/** Writes one extracted entry to `<root>/<rel>`, creating parent dirs. */
async function writeEntry(
  root: string,
  rel: string,
  data: Uint8Array,
): Promise<void> {
  const abs = path.join(root, ...rel.split("/"));
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
}

/**
 * Returns the manifest's declared paths for a section, or auto-discovers them
 * from the ZIP entries when the list is omitted. Discovery matches entries
 * under `dir/` whose path satisfies `matches` (relative to that dir).
 */
function listOrDiscover(
  entries: ZipEntries,
  declared: string[] | undefined,
  dir: string,
  matches: (rel: string) => boolean,
): string[] {
  if (declared) return declared;
  const prefix = `${dir}/`;
  return Object.keys(entries)
    .filter(
      (name) => name.startsWith(prefix) && matches(name.slice(prefix.length)),
    )
    .sort();
}

/** A skill entry is `skills/<name>/SKILL.md`. */
function isSkillEntry(rel: string): boolean {
  const parts = rel.split("/");
  return parts.length === 2 && parts[1] === "SKILL.md";
}

/** Absolute path to a section dir inside the session's installed bundle. */
function tangentDir(root: string, dir: string): string {
  return path.join(root, TANGENT_DIRNAME, dir);
}

/** Builds Prime's tool allowlist from the manifest, adding required tools. */
function resolvePrimeTools(manifest: BundleManifest): string[] {
  const base = manifest.prime.tools ?? [...DEFAULT_TOOLS];
  return [
    ...new Set([
      ...base,
      ...SHARED_AGENT_TOOLS,
      ...PRIME_ORCHESTRATION_TOOLS,
      ...PRIME_MEMORY_TOOLS,
      ...PRIME_TRIGGER_TOOLS,
      ...PRIME_SESSION_TOOLS,
    ]),
  ];
}

/**
 * Mirrors the whole bundle tree under `<root>/.tangent/` so prompts, skills,
 * workflows, agents, tools, icon, and manifest live alongside the session but
 * out of its way.
 */
async function writeBundleTree(
  rootPath: string,
  entries: ZipEntries,
): Promise<void> {
  for (const [rel, data] of Object.entries(entries)) {
    await writeEntry(rootPath, path.posix.join(TANGENT_DIRNAME, rel), data);
  }
}

/**
 * Copies the rules file and seed memory/context files to the workspace root,
 * where Pi auto-discovers `AGENTS.md` and memory from its `cwd`. Memory/context
 * files are flattened to their basename.
 */
async function copyRootFiles(
  rootPath: string,
  entries: ZipEntries,
  manifest: BundleManifest,
): Promise<void> {
  const rulesRel = `${BUNDLE_DIRS.rules}/${RULES_FILENAME}`;
  if (entries[rulesRel]) {
    await writeEntry(rootPath, RULES_FILENAME, entries[rulesRel]);
  }

  const memoryFiles = listOrDiscover(
    entries,
    manifest.memory,
    BUNDLE_DIRS.memory,
    (rel) => rel.endsWith(".md"),
  );
  for (const rel of [...memoryFiles, ...(manifest.contextFiles ?? [])]) {
    const data = entries[rel];
    if (!data) throw new Error(`bundle: missing file "${rel}"`);
    await writeEntry(rootPath, path.basename(rel), data);
  }
}

/** Absolute paths passed to Pi for the bundle's skills/workflows/extensions. */
interface SectionPaths {
  skillPaths: string[];
  workflowPaths: string[];
  extensionPaths: string[];
}

/** Resolves the skill/workflow/extension paths against the installed tree. */
function resolveSectionPaths(
  entries: ZipEntries,
  manifest: BundleManifest,
  installRoot: string,
): SectionPaths {
  const toAbs = (rel: string) => path.join(installRoot, ...rel.split("/"));

  const skills = listOrDiscover(
    entries,
    manifest.skills,
    BUNDLE_DIRS.skills,
    isSkillEntry,
  );
  const workflows = listOrDiscover(
    entries,
    manifest.workflows,
    BUNDLE_DIRS.workflows,
    (rel) => rel.endsWith(".md") && !rel.includes("/"),
  );
  const extensions = listOrDiscover(
    entries,
    manifest.extensions,
    BUNDLE_DIRS.tools,
    (rel) => rel.endsWith(".ts") && !rel.includes("/"),
  );

  return {
    // Pi's --skill accepts a directory; pass each skill's directory (the one
    // containing SKILL.md) rather than the SKILL.md file itself.
    skillPaths: skills.map((rel) => path.dirname(toAbs(rel))),
    workflowPaths: workflows.map(toAbs),
    extensionPaths: extensions.map(toAbs),
  };
}

/**
 * Transpiles each declared trigger handler to a self-contained IIFE under
 * `<installRoot>/triggers/<name>.js`, exposing the module as `__tgHandler` for
 * {@link import("../triggers/handlerRunner.ts")} to invoke. The handler sources
 * already live on disk (written by {@link writeBundleTree}), so esbuild resolves
 * their relative sibling imports; node built-ins stay external. Throws when a
 * declared handler is missing from the zip or fails to compile, so a bad bundle
 * fails install rather than at fire time.
 */
async function compileTriggerHandler(
  handler: string,
  name: string,
  entries: ZipEntries,
  installRoot: string,
  outDir: string,
): Promise<void> {
  if (!entries[handler]) {
    throw new Error(`bundle: trigger handler "${handler}" not found`);
  }
  await mkdir(outDir, { recursive: true });

  let output: string;
  try {
    const result = await build({
      entryPoints: [path.join(installRoot, ...handler.split("/"))],
      bundle: true,
      format: "iife",
      globalName: "__tgHandler",
      platform: "node",
      write: false,
      logLevel: "silent",
    });
    output = result.outputFiles[0].text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `bundle: failed to compile trigger handler "${handler}"\n${message}`,
      { cause: err },
    );
  }
  await writeFile(path.join(outDir, `${name}.js`), output);
}

async function compileTriggerHandlers(
  entries: ZipEntries,
  manifest: BundleManifest,
  installRoot: string,
): Promise<void> {
  const triggers = manifest.triggers ?? [];
  const outDir = path.join(installRoot, BUNDLE_DIRS.triggers);

  for (const trigger of triggers) {
    if (trigger.handler) {
      await compileTriggerHandler(
        trigger.handler,
        trigger.name,
        entries,
        installRoot,
        outDir,
      );
    }
  }
}

/** Resolves the sub-agent defaults from the manifest's `subagents` block. */
function resolveSubagentDefaults(
  entries: ZipEntries,
  manifest: BundleManifest,
): SubagentDefaults {
  const defaultPrompt = manifest.subagents?.defaultSystemPrompt;
  return {
    tools: manifest.subagents?.defaultTools,
    appendSystemPrompt: defaultPrompt
      ? readTextEntry(entries, defaultPrompt)
      : undefined,
    model: manifest.subagents?.defaultModel,
    thinkingDepth: manifest.subagents?.defaultThinking,
  };
}

/**
 * Installs a Configuration Bundle into a session's root folder and resolves it
 * into a {@link ResolvedSessionConfig} the agent manager spawns Pi with.
 *
 * The bundle tree is written under `<root>/.tangent/` (manifest, icon, prompts,
 * skills, workflows, agents, tools). The rules file and seed memory/context
 * files are additionally copied to the workspace root so Pi auto-discovers
 * `AGENTS.md` and memory from its `cwd`. Conventional directories are
 * auto-discovered when their manifest list is omitted; when present, the
 * manifest is authoritative.
 *
 * Throws on an invalid manifest, an unsafe ZIP entry, or a missing referenced
 * file.
 */
export async function installBundle(
  zipBuffer: Buffer,
  rootPath: string,
): Promise<InstalledBundle> {
  const entries = readZipEntries(zipBuffer);

  const parsed = parseManifest(readTextEntry(entries, MANIFEST_FILENAME));
  if ("errors" in parsed) {
    throw new Error(`bundle: invalid manifest\n${parsed.errors.join("\n")}`);
  }
  const manifest = parsed.manifest;

  await writeBundleTree(rootPath, entries);
  await copyRootFiles(rootPath, entries, manifest);

  const installRoot = path.join(rootPath, TANGENT_DIRNAME);
  await compileTriggerHandlers(entries, manifest, installRoot);
  const config = resolveSessionConfig(entries, manifest, rootPath);

  return { manifest, config };
}

/**
 * Resolves a bundle's {@link ResolvedSessionConfig} from its (bundle-relative)
 * entries and parsed manifest. Shared by {@link installBundle} (entries from the
 * uploaded ZIP) and {@link loadInstalledConfig} (entries read back from the
 * installed `.tangent/` tree), so a freshly installed session and a revived one
 * resolve to exactly the same config.
 */
export function resolveSessionConfig(
  entries: ZipEntries,
  manifest: BundleManifest,
  rootPath: string,
): ResolvedSessionConfig {
  const installRoot = path.join(rootPath, TANGENT_DIRNAME);
  return {
    prime: {
      tools: resolvePrimeTools(manifest),
      appendSystemPrompt: composePrimePrompt(
        readTextEntry(entries, manifest.prime.systemPrompt),
      ),
      model: manifest.prime.model,
      thinkingDepth: manifest.prime.thinking,
    },
    subagentDefaults: resolveSubagentDefaults(entries, manifest),
    templates: buildTemplatesFromDir(tangentDir(rootPath, BUNDLE_DIRS.agents)),
    ...(manifest.prime.welcomeMessage
      ? {
          welcomeMessage: readTextEntry(entries, manifest.prime.welcomeMessage),
        }
      : {}),
    ...resolveSectionPaths(entries, manifest, installRoot),
  };
}

/**
 * Re-resolves the config for a session whose bundle was previously installed
 * under `<rootPath>/.tangent/`, without re-uploading the ZIP. Returns
 * `undefined` for a plain session (no installed manifest), so the caller falls
 * back to the global default config.
 *
 * The installed tree mirrors the original bundle layout (written by
 * {@link writeBundleTree}), so reading every file back into a
 * {@link ZipEntries} map keyed by the bundle-relative path lets us reuse the
 * exact same {@link resolveSessionConfig} path used at install time. Triggers
 * are already compiled on disk, so they are not recompiled here.
 */
export function loadInstalledConfig(
  rootPath: string,
): ResolvedSessionConfig | undefined {
  const installRoot = path.join(rootPath, TANGENT_DIRNAME);
  if (!existsSync(path.join(installRoot, MANIFEST_FILENAME))) return undefined;

  const entries = readInstalledEntries(installRoot);
  const parsed = parseManifest(readTextEntry(entries, MANIFEST_FILENAME));
  if ("errors" in parsed) {
    throw new Error(`bundle: invalid manifest\n${parsed.errors.join("\n")}`);
  }
  return resolveSessionConfig(entries, parsed.manifest, rootPath);
}

/**
 * Reads every file under the installed `.tangent/` tree into a
 * {@link ZipEntries} map keyed by its POSIX path relative to `installRoot`
 * (matching the original bundle-relative keys produced from the ZIP).
 */
function readInstalledEntries(installRoot: string): ZipEntries {
  const entries: ZipEntries = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) {
        const rel = path.relative(installRoot, abs).split(path.sep).join("/");
        console.warn(`bundle: skipping non-file entry "${rel}"`);
        continue;
      }
      const rel = path.relative(installRoot, abs).split(path.sep).join("/");
      entries[rel] = new Uint8Array(readFileSync(abs));
    }
  };
  walk(installRoot);
  return entries;
}
