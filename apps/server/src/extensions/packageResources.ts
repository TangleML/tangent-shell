import { type Dirent, existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { GlobalExtensionResources } from "@tangent/shared/contracts.ts";

/** Conventional resource directories Pi discovers when no manifest declares them. */
const CONVENTIONAL_DIRS = {
  extensions: "extensions",
  skills: "skills",
  prompts: "prompts",
} as const;

/** File extensions treated as loadable Pi extensions. */
const EXTENSION_EXTS = new Set([".ts", ".js", ".mjs", ".cjs"]);

/** File extensions treated as prompt templates. */
const PROMPT_EXTS = new Set([".md"]);

/** The `pi` manifest block (and a Tangent tools hint) read from package.json. */
interface PiPackageManifest {
  pi?: {
    extensions?: string[];
    skills?: string[];
    prompts?: string[];
    tools?: string[];
  };
  tangent?: { tools?: string[] };
  name?: string;
  version?: string;
}

/** The `pi` block of a manifest, or `undefined` when none is declared. */
type PiBlock = PiPackageManifest["pi"];

/** Reads and parses a package root's `package.json`, or `undefined` if absent. */
export async function readPackageManifest(
  root: string,
): Promise<PiPackageManifest | undefined> {
  const manifestPath = path.join(root, "package.json");
  if (!existsSync(manifestPath)) return undefined;
  try {
    return JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as PiPackageManifest;
  } catch {
    return undefined;
  }
}

/** A manifest block's declared tool names, if any. */
function blockTools(
  block: { tools?: string[] } | undefined,
): string[] | undefined {
  return block?.tools;
}

/** The tool names a package declares (`tangent.tools`, then `pi.tools`). */
export function declaredTools(
  manifest: PiPackageManifest | undefined,
): string[] {
  return blockTools(manifest?.tangent) ?? blockTools(manifest?.pi) ?? [];
}

/** Lists a directory's entries with file types, or `[]` when it is missing. */
async function readdirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Directory names skipped by {@link walkFiles}. */
function isIgnoredEntry(name: string): boolean {
  return name === "node_modules" || name === ".git";
}

/** Recursively lists POSIX file paths under `dir`, skipping `node_modules`/`.git`. */
async function walkFiles(dir: string, base: string = dir): Promise<string[]> {
  const entries = await readdirSafe(dir);
  const files: string[] = [];
  for (const entry of entries) {
    if (isIgnoredEntry(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(abs, base)));
    } else if (entry.isFile()) {
      files.push(path.relative(base, abs).split(path.sep).join("/"));
    }
  }
  return files;
}

/** The regex fragment and extra index advance for a `*`/`**` at `glob[i]`. */
function translateStar(
  glob: string,
  i: number,
): { fragment: string; advance: number } | undefined {
  if (glob[i] !== "*") return undefined;
  if (glob[i + 1] !== "*") return { fragment: "[^/]*", advance: 0 };
  return { fragment: ".*", advance: glob[i + 2] === "/" ? 2 : 1 };
}

/** The regex fragment for one non-`*` glob character. */
function translateChar(char: string): string {
  if (char === "?") return "[^/]";
  return /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

/** Translates a glob (`*`, `**`, `?`) into an anchored RegExp over POSIX paths. */
function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const star = translateStar(glob, i);
    if (star) {
      out += star.fragment;
      i += star.advance;
      continue;
    }
    out += translateChar(glob[i]);
  }
  return new RegExp(`^${out}$`);
}

/** Strips a leading `./` and a trailing `/` from a manifest-relative path. */
function normalizePattern(pattern: string): string {
  return pattern.replace(/^\.\//, "").replace(/\/+$/, "");
}

/** Whether a normalized pattern contains a glob wildcard. */
function hasWildcard(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?");
}

/** POSIX files under a root-relative directory whose extension is in `exts`. */
function filesInDir(
  relFiles: string[],
  dir: string,
  exts: Set<string>,
): string[] {
  const prefix = dir === "" ? "" : `${dir}/`;
  return relFiles.filter(
    (rel) =>
      rel.startsWith(prefix) &&
      (dir === ""
        ? !rel.includes("/")
        : !rel.slice(prefix.length).includes("/")) &&
      exts.has(path.extname(rel).toLowerCase()),
  );
}

/** The files one prompt include pattern contributes: glob, file, or directory. */
function matchInclude(
  root: string,
  relFiles: string[],
  pattern: string,
  exts: Set<string>,
): string[] {
  if (hasWildcard(pattern)) {
    const regex = globToRegExp(pattern);
    return relFiles.filter((rel) => regex.test(rel));
  }
  if (!existsSync(path.join(root, pattern))) return [];
  if (relFiles.includes(pattern)) return [pattern];
  return filesInDir(relFiles, pattern, exts);
}

/**
 * The extension(s) one include pattern contributes. A glob matches code files;
 * a literal file or directory is kept as-is. Unlike prompts, a declared
 * directory is a single extension (Pi resolves its `index.*` entry at load, or
 * discovers the files inside when there is none), so we must not expand it into
 * every file — that would wrongly pull in a package `bin` CLI or other
 * non-extension code sitting beside the entry point.
 */
function matchExtensionInclude(
  root: string,
  relFiles: string[],
  pattern: string,
): string[] {
  if (hasWildcard(pattern)) {
    const regex = globToRegExp(pattern);
    return relFiles.filter(
      (rel) =>
        regex.test(rel) && EXTENSION_EXTS.has(path.extname(rel).toLowerCase()),
    );
  }
  return existsSync(path.join(root, pattern)) ? [pattern] : [];
}

/**
 * Resolves an include/exclude pattern set into a sorted, deduped path list. A
 * `!`-prefixed pattern excludes glob matches; `includeMatcher` turns each
 * remaining pattern into the paths it contributes.
 */
function resolvePatternSet(
  patterns: string[],
  includeMatcher: (pattern: string) => string[],
): string[] {
  const excludes = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => globToRegExp(normalizePattern(pattern.slice(1))));

  const matched = new Set<string>();
  for (const raw of patterns) {
    if (raw.startsWith("!")) continue;
    for (const rel of includeMatcher(normalizePattern(raw))) matched.add(rel);
  }
  return [...matched]
    .filter((rel) => !excludes.some((regex) => regex.test(rel)))
    .sort();
}

/** Resolves `prompts`-style patterns (a literal directory expands to files). */
function resolveFilePatterns(
  root: string,
  relFiles: string[],
  patterns: string[],
  exts: Set<string>,
): string[] {
  return resolvePatternSet(patterns, (pattern) =>
    matchInclude(root, relFiles, pattern, exts),
  );
}

/** Resolves `extensions` patterns (a literal directory stays a single entry). */
function resolveExtensionPatterns(
  root: string,
  relFiles: string[],
  patterns: string[],
): string[] {
  return resolvePatternSet(patterns, (pattern) =>
    matchExtensionInclude(root, relFiles, pattern),
  );
}

/** The child directories of `dir` that directly hold a `SKILL.md`. */
async function childSkillDirs(dir: string): Promise<string[]> {
  const dirs: string[] = [];
  for (const entry of await readdirSafe(dir)) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    if (existsSync(path.join(child, "SKILL.md"))) dirs.push(child);
  }
  return dirs;
}

/** Resolves absolute skill directories for one skill candidate path. */
async function skillDirsFor(abs: string): Promise<string[]> {
  if (!existsSync(abs)) return [];
  const info = await stat(abs);
  if (info.isFile()) {
    return path.basename(abs) === "SKILL.md" ? [path.dirname(abs)] : [];
  }
  if (!info.isDirectory()) return [];
  if (existsSync(path.join(abs, "SKILL.md"))) return [abs];
  return childSkillDirs(abs);
}

/** The absolute candidate paths one skill pattern points at. */
function candidatePaths(
  root: string,
  relFiles: string[],
  pattern: string,
): string[] {
  if (!hasWildcard(pattern)) return [path.join(root, pattern)];
  const regex = globToRegExp(pattern);
  return relFiles
    .filter((rel) => regex.test(rel))
    .map((rel) => path.join(root, rel));
}

/** Every absolute candidate path the (non-excluding) skill patterns point at. */
function skillCandidates(
  root: string,
  relFiles: string[],
  patterns: string[],
): string[] {
  const candidates = new Set<string>();
  for (const raw of patterns) {
    if (raw.startsWith("!")) continue;
    for (const abs of candidatePaths(root, relFiles, normalizePattern(raw))) {
      candidates.add(abs);
    }
  }
  return [...candidates];
}

/** Resolves skill patterns into root-relative skill directory paths. */
async function resolveSkillPatterns(
  root: string,
  relFiles: string[],
  patterns: string[],
): Promise<string[]> {
  const dirs = new Set<string>();
  for (const candidate of skillCandidates(root, relFiles, patterns)) {
    for (const dir of await skillDirsFor(candidate)) {
      dirs.add(relOrDot(root, dir));
    }
  }
  return [...dirs].sort();
}

/** POSIX relative path for an absolute dir under root (`.` when equal). */
function relOrDot(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/") || ".";
}

/** The extension paths a package contributes: declared, else conventional. */
function resolveExtensions(
  root: string,
  relFiles: string[],
  pi: PiBlock,
): string[] {
  if (pi?.extensions) {
    return resolveExtensionPatterns(root, relFiles, pi.extensions);
  }
  return conventionalExtensions(root, relFiles);
}

/** The skill paths a package contributes: declared, else conventional. */
async function resolveSkills(
  root: string,
  relFiles: string[],
  pi: PiBlock,
): Promise<string[]> {
  if (pi?.skills) return resolveSkillPatterns(root, relFiles, pi.skills);
  return conventionalSkills(root);
}

/** The prompt paths a package contributes: declared, else conventional. */
function resolvePrompts(
  root: string,
  relFiles: string[],
  pi: PiBlock,
): string[] {
  if (pi?.prompts) {
    return resolveFilePatterns(root, relFiles, pi.prompts, PROMPT_EXTS);
  }
  return conventionalPrompts(root, relFiles);
}

/**
 * Resolves a package root into the Pi resource paths it contributes, as POSIX
 * paths relative to that root. Follows Pi's package rules: a declared `pi`
 * manifest wins per resource type; an undeclared type falls back to its
 * conventional directory; a package with none of those exposes a root
 * `SKILL.md` as one skill and lone extension files as extensions.
 */
export async function resolvePackageResources(
  root: string,
): Promise<GlobalExtensionResources> {
  const manifest = await readPackageManifest(root);
  const relFiles = await walkFiles(root);
  const pi = manifest?.pi;

  const extensions = resolveExtensions(root, relFiles, pi);
  const skills = await resolveSkills(root, relFiles, pi);
  const prompts = resolvePrompts(root, relFiles, pi);

  if (extensions.length === 0 && skills.length === 0 && prompts.length === 0) {
    return rootFallback(root, relFiles);
  }
  return { extensions, skills, prompts };
}

/** Conventional `extensions/` discovery: top-level code files. */
function conventionalExtensions(root: string, relFiles: string[]): string[] {
  const dir = path.join(root, CONVENTIONAL_DIRS.extensions);
  if (!existsSync(dir)) return [];
  return filesInDir(
    relFiles,
    CONVENTIONAL_DIRS.extensions,
    EXTENSION_EXTS,
  ).sort();
}

/** Conventional `skills/` discovery: skill directories holding a SKILL.md. */
async function conventionalSkills(root: string): Promise<string[]> {
  const dir = path.join(root, CONVENTIONAL_DIRS.skills);
  if (!existsSync(dir)) return [];
  const dirs = await skillDirsFor(dir);
  return dirs.map((abs) => relOrDot(root, abs)).sort();
}

/** Conventional `prompts/` discovery: top-level markdown files. */
function conventionalPrompts(root: string, relFiles: string[]): string[] {
  const dir = path.join(root, CONVENTIONAL_DIRS.prompts);
  if (!existsSync(dir)) return [];
  return filesInDir(relFiles, CONVENTIONAL_DIRS.prompts, PROMPT_EXTS).sort();
}

/** No-manifest, no-conventional-dir fallback: root SKILL.md / lone code files. */
function rootFallback(
  root: string,
  relFiles: string[],
): GlobalExtensionResources {
  const skills = existsSync(path.join(root, "SKILL.md")) ? ["."] : [];
  const extensions = relFiles.filter(
    (rel) =>
      !rel.includes("/") && EXTENSION_EXTS.has(path.extname(rel).toLowerCase()),
  );
  return { extensions: extensions.sort(), skills, prompts: [] };
}
