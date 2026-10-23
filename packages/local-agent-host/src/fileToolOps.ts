import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  boundedInt,
  optionalString,
  requiredString,
  type ToolArgs,
} from "./toolArgs.ts";
import {
  globMatcher,
  IGNORED_DIRS,
  isBinary,
  isDeniedReadPath,
  resolveExisting,
  walkFiles,
} from "./workspaceFs.ts";

export const DEFAULT_READ_BYTES = 256 * 1024;
export const MAX_READ_BYTES = 1024 * 1024;
export const DEFAULT_MAX_RESULTS = 200;
export const MAX_RESULTS = 1000;
/** Larger files are skipped by `search_text` rather than read whole. */
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;
const MAX_MATCH_LINE_CHARS = 300;

function resultLimit(args: ToolArgs): number {
  return boundedInt(args, "maxResults", DEFAULT_MAX_RESULTS, MAX_RESULTS);
}

function limitNote(count: number, limit: number): string {
  return count >= limit ? `\n… stopped at ${limit} results` : "";
}

export async function readTextFile(
  root: string,
  args: ToolArgs,
): Promise<string> {
  const relative = requiredString(args, "path");
  if (isDeniedReadPath(relative)) {
    throw new Error(`"${relative}" is not readable.`);
  }
  const maxBytes = boundedInt(
    args,
    "maxBytes",
    DEFAULT_READ_BYTES,
    MAX_READ_BYTES,
  );
  const file = await resolveExisting(root, relative);
  const { size } = await stat(file);
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(Math.min(size, maxBytes));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const content = buffer.subarray(0, bytesRead);
    if (isBinary(content)) throw new Error(`"${relative}" is a binary file.`);
    const text = content.toString("utf8");
    if (size <= maxBytes) return text;
    return `${text}\n… truncated (showing ${bytesRead} of ${size} bytes)`;
  } finally {
    await handle.close();
  }
}

export async function listDirectory(
  root: string,
  args: ToolArgs,
): Promise<string> {
  const relative = optionalString(args, "path") ?? ".";
  const dir = await resolveExisting(root, relative);
  const entries = await readdir(dir, { withFileTypes: true });
  const lines = entries
    .filter((entry) => !IGNORED_DIRS.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
  return lines.length > 0 ? lines.join("\n") : "(empty directory)";
}

export async function findFiles(root: string, args: ToolArgs): Promise<string> {
  const matches = globMatcher(requiredString(args, "glob"));
  const limit = resultLimit(args);
  const found: string[] = [];
  for await (const file of walkFiles(root)) {
    if (!matches(file)) continue;
    found.push(file);
    if (found.length >= limit) break;
  }
  if (found.length === 0) return "No files matched.";
  return found.join("\n") + limitNote(found.length, limit);
}

function searchPattern(args: ToolArgs): RegExp {
  const query = requiredString(args, "query");
  const source =
    args.regex === true ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(source, args.ignoreCase === true ? "i" : "");
}

/**
 * A file's text for searching, or `undefined` when it is too large, binary, or
 * no longer readable — a file removed or permission-changed between the walk
 * and the read skips rather than failing the whole search.
 */
async function searchableText(full: string): Promise<string | undefined> {
  try {
    if ((await stat(full)).size > MAX_SEARCH_FILE_BYTES) return undefined;
    const buffer = await readFile(full);
    return isBinary(buffer) ? undefined : buffer.toString("utf8");
  } catch {
    return undefined;
  }
}

/** Matching lines of one file as `path:line: text`, at most `limit`. */
async function searchFile(
  root: string,
  file: string,
  pattern: RegExp,
  limit: number,
): Promise<string[]> {
  const text = await searchableText(path.join(root, file));
  if (text === undefined) return [];
  const hits: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length && hits.length < limit; i++) {
    const line = lines[i] ?? "";
    if (!pattern.test(line)) continue;
    hits.push(
      `${file}:${i + 1}: ${line.trim().slice(0, MAX_MATCH_LINE_CHARS)}`,
    );
  }
  return hits;
}

export async function searchText(
  root: string,
  args: ToolArgs,
): Promise<string> {
  const pattern = searchPattern(args);
  const glob = optionalString(args, "glob");
  const matches = glob ? globMatcher(glob) : () => true;
  const limit = resultLimit(args);
  const eligible = (file: string): boolean =>
    !isDeniedReadPath(file) && matches(file);
  const hits: string[] = [];
  for await (const file of walkFiles(root)) {
    if (hits.length >= limit) break;
    if (!eligible(file)) continue;
    hits.push(...(await searchFile(root, file, pattern, limit - hits.length)));
  }
  if (hits.length === 0) return "No matches.";
  return hits.join("\n") + limitNote(hits.length, limit);
}
