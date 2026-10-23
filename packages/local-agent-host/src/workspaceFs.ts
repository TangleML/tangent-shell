import { readdir, realpath } from "node:fs/promises";
import path from "node:path";

export const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".turbo",
  ".next",
  ".venv",
  "__pycache__",
]);

const BINARY_SNIFF_BYTES = 8 * 1024;

/** Path segments whose contents are VCS internals or secrets, never read. */
const DENIED_READ_DIRS = new Set([".git"]);

/**
 * Whether a workspace-relative path must not have its contents read even though
 * it lives inside the root: version-control internals (`.git/**`) and dotenv
 * secret files (`.env`, `.env.local`, ...). Traversal already skips ignored
 * directories, but `read_file`/`search_text` can still name such a path
 * directly, so they consult this before returning any bytes to the remote peer.
 */
export function isDeniedReadPath(relative: string): boolean {
  const segments = relative
    .replace(/^\.\//, "")
    .split(/[\\/]/)
    .filter((segment) => segment && segment !== ".");
  if (segments.some((segment) => DENIED_READ_DIRS.has(segment))) return true;
  const name = segments.at(-1) ?? "";
  return name === ".env" || name.startsWith(".env.");
}

const GLOB_TOKENS: Record<string, string> = {
  "**/": "(?:.*/)?",
  "**": ".*",
  "*": "[^/]*",
  "?": "[^/]",
  "{": "(?:",
  "}": ")",
  ",": "|",
};

function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/** Resolves a workspace-relative path, refusing anything that escapes `root`. */
export function resolveWithinRoot(root: string, relative = "."): string {
  if (path.isAbsolute(relative)) {
    throw new Error("Paths must be relative to the workspace root.");
  }
  const resolved = path.resolve(root, relative);
  if (!isInside(root, resolved)) {
    throw new Error(`Path "${relative}" is outside the workspace.`);
  }
  return resolved;
}

/** Like {@link resolveWithinRoot}, but also refuses symlinks that point outside. */
export async function resolveExisting(
  root: string,
  relative = ".",
): Promise<string> {
  const resolved = resolveWithinRoot(root, relative);
  const [realRoot, realTarget] = await Promise.all([
    realpath(root),
    realpath(resolved).catch(() => {
      throw new Error(`"${relative}" does not exist.`);
    }),
  ]);
  if (!isInside(realRoot, realTarget)) {
    throw new Error(`Path "${relative}" is outside the workspace.`);
  }
  return realTarget;
}

/**
 * Compiles a glob (`*`, `**`, `?`, `{a,b}`). A pattern without `/` matches a
 * file's base name anywhere in the tree, so `*.ts` matches at any depth.
 */
export function globMatcher(glob: string): (relative: string) => boolean {
  const pattern = glob.trim().replace(/^\.\//, "");
  const source = pattern.replace(
    /\*\*\/|\*\*|\*|\?|\{|\}|,|[.+^$()|[\]\\]/g,
    (token) => GLOB_TOKENS[token] ?? `\\${token}`,
  );
  const regex = new RegExp(`^(?:${source})$`);
  const byName = !pattern.includes("/");
  return (relative) =>
    regex.test(byName ? path.posix.basename(relative) : relative);
}

export function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/** Yields workspace-relative posix paths of regular files, skipping ignored dirs and symlinks. */
export async function* walkFiles(
  root: string,
  dir = root,
): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile()) yield toPosix(path.relative(root, full));
    else if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
      yield* walkFiles(root, full);
    }
  }
}
