import { createHash } from "node:crypto";

import { z } from "zod";

import type { MemoryDigestStats, MemoryExecuteResult } from "./types.ts";

/** pi-memory's entry stamp, so its forget/restore keep working on our stores. */
export const ENTRY_STAMP =
  /^<!-- (?:(?:last updated: )?\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}|HANDOFF \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[[^\]\r\n]+\] -->$/;

/** Stores at or below this size are injected whole. */
export const INLINE_MAX_CHARS = 3000;

/**
 * Session and global memory carry host-seeded instructions, not append-only
 * notes, so they stay inline far longer than the knowledge base or project note.
 */
export const SESSION_INLINE_MAX_CHARS = 16000;

/** Most entries a contents list shows; the rest are summarized by count. */
export const TOC_MAX_ENTRIES = 80;

const MAX_TITLE_CHARS = 80;
const HEADING = /^#{1,6}\s+\S/;
const TAG_LINE = /^#[^\s#]+(?:\s+#[^\s#]+)*$/;

/** The short title a write tool requires, shown in the contents list. */
export const titleSchema = z
  .string()
  .trim()
  .min(1, "title must not be empty")
  .max(MAX_TITLE_CHARS, `title must be at most ${MAX_TITLE_CHARS} characters`)
  .refine((title) => !title.includes("\n"), "title must be one line");

export const tagsSchema = z.array(z.string().trim().min(1)).max(10).optional();

/** `#tag` tokens on one line; spaces inside a tag become dashes. */
export function formatTags(tags: readonly string[] = []): string {
  return tags
    .map((tag) => tag.trim().replace(/^#+/, "").replace(/\s+/g, "-"))
    .filter(Boolean)
    .map((tag) => `#${tag}`)
    .join(" ");
}

/** An entry as written: a `### title` line, the body, then its tag line. */
export function titledEntry(
  title: string | undefined,
  body: string,
  tags?: readonly string[],
): string {
  const text = body.trim();
  const heading = title?.trim();
  const head = heading ? `### ${heading}\n${text}` : text;
  return [head, formatTags(tags)].filter(Boolean).join("\n\n");
}

/**
 * How a store's text splits into entries: pi-memory stamps, blank-line
 * paragraphs (SimpleMD appends), or markdown headings (a free-form note, which
 * falls back to paragraphs when it has none).
 */
export type EntryFormat = "stamped" | "paragraphs" | "headings";

/** One addressable piece of a memory store. */
export interface MemoryEntry {
  /** Hash of the entry's text, so it survives edits elsewhere in the file. */
  id: string;
  title: string;
  date?: string;
  tags: string[];
  /** 1-based, inclusive line range in the file. */
  lines: [number, number];
  text: string;
}

interface RawBlock {
  start: number;
  lines: string[];
}

/** Splits `lines` into blocks, starting a new one at each `boundary` line. */
function splitAt(
  lines: readonly string[],
  boundary: (line: string) => boolean,
): RawBlock[] {
  const blocks: RawBlock[] = [{ start: 0, lines: [] }];
  lines.forEach((line, index) => {
    if (boundary(line)) blocks.push({ start: index, lines: [] });
    blocks[blocks.length - 1].lines.push(line);
  });
  return blocks;
}

/** Splits a block into its blank-line-separated paragraphs. */
function paragraphs(block: RawBlock): RawBlock[] {
  const out: RawBlock[] = [];
  let current: RawBlock | undefined;
  block.lines.forEach((line, offset) => {
    if (!line.trim()) {
      current = undefined;
      return;
    }
    if (!current) {
      current = { start: block.start + offset, lines: [] };
      out.push(current);
    }
    current.lines.push(line);
  });
  return out;
}

/** The blocks after the first boundary stay whole; the text before it splits
 * into paragraphs. */
function bounded(
  lines: readonly string[],
  boundary: (line: string) => boolean,
): RawBlock[] {
  const [lead, ...rest] = splitAt(lines, boundary);
  return [...paragraphs(lead), ...rest];
}

function rawBlocks(content: string, format: EntryFormat): RawBlock[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  if (format === "stamped") {
    return bounded(lines, (line) => ENTRY_STAMP.test(line));
  }
  if (format === "headings" && lines.some((line) => HEADING.test(line))) {
    return bounded(lines, (line) => HEADING.test(line));
  }
  return paragraphs({ start: 0, lines });
}

function entryId(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return createHash("sha1").update(normalized).digest("hex").slice(0, 6);
}

function titleOf(lines: readonly string[]): string {
  const first = lines.find(
    (line) =>
      line.trim() && !ENTRY_STAMP.test(line) && !TAG_LINE.test(line.trim()),
  );
  const plain = (first ?? "")
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/\*\*|__/g, "");
  if (!plain) return "(untitled)";
  return plain.length > MAX_TITLE_CHARS
    ? `${plain.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`
    : plain;
}

function tagsOf(lines: readonly string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => TAG_LINE.test(line))
    .flatMap((line) => line.split(/\s+/));
}

function toEntry(block: RawBlock): MemoryEntry | undefined {
  const text = block.lines.join("\n").trim();
  if (!text) return undefined;
  const lead = block.lines.findIndex((line) => line.trim());
  const trail = block.lines.findLastIndex((line) => line.trim());
  const stamp = block.lines.find((line) => ENTRY_STAMP.test(line));
  return {
    id: entryId(text),
    title: titleOf(block.lines),
    date: stamp?.match(/\d{4}-\d{2}-\d{2}/)?.[0],
    tags: tagsOf(block.lines),
    lines: [block.start + lead + 1, block.start + trail + 1],
    text,
  };
}

/** The entries of a store's text, in file order. */
export function parseEntries(
  content: string,
  format: EntryFormat,
): MemoryEntry[] {
  return rawBlocks(content, format)
    .map(toEntry)
    .filter((entry): entry is MemoryEntry => entry !== undefined);
}

/** Splits a comma-separated `entry` parameter into ids. */
export function entryIds(param: string): string[] {
  return param
    .split(/[\s,]+/)
    .map((id) => id.replace(/`/g, "").trim().toLowerCase())
    .filter(Boolean);
}

/** The entries whose id is in `ids`, plus the ids that matched none. */
export function findEntries(
  entries: readonly MemoryEntry[],
  ids: readonly string[],
): { found: MemoryEntry[]; missing: string[] } {
  const wanted = new Set(ids);
  const found = entries.filter((entry) => wanted.has(entry.id));
  const seen = new Set(found.map((entry) => entry.id));
  return { found, missing: ids.filter((id) => !seen.has(id)) };
}

/** How a digest presents its store. */
export interface DigestOptions {
  /** How to fetch one entry, e.g. ``kb_read { entry: "<id>" }``. */
  fetchHint: string;
  /** Newest first (append-only stores) or file order (a free-form note). */
  order: "newest" | "file";
  /** Show each entry's line range (when agents read slices with file tools). */
  showLines?: boolean;
  /** Where to find entries beyond {@link TOC_MAX_ENTRIES}. */
  overflowHint: string;
  /** Size this store stays inline up to; defaults to {@link INLINE_MAX_CHARS}. */
  inlineMaxChars?: number;
}

function contentsLine(entry: MemoryEntry, options: DigestOptions): string {
  const parts = [
    `\`${entry.id}\``,
    options.showLines ? `L${entry.lines[0]}-${entry.lines[1]}` : "",
    entry.title,
    entry.date ? `(${entry.date})` : "",
    entry.tags.join(" "),
  ];
  return `- ${parts.filter(Boolean).join(" ")}`;
}

/** Tags mapped to the ids carrying them, most used first. */
function keywordLines(entries: readonly MemoryEntry[]): string[] {
  const byTag = new Map<string, string[]>();
  for (const entry of entries) {
    for (const tag of new Set(entry.tags)) {
      byTag.set(tag, [...(byTag.get(tag) ?? []), entry.id]);
    }
  }
  return [...byTag.entries()]
    .sort(
      ([a, aIds], [b, bIds]) => bIds.length - aIds.length || a.localeCompare(b),
    )
    .map(
      ([tag, ids]) => `- ${tag}: ${ids.map((id) => `\`${id}\``).join(", ")}`,
    );
}

function newestDate(entries: readonly MemoryEntry[]): string | undefined {
  return entries
    .map((entry) => entry.date)
    .filter((date): date is string => date !== undefined)
    .sort()
    .at(-1);
}

function summaryLine(
  entries: readonly MemoryEntry[],
  chars: number,
  options: DigestOptions,
): string {
  const newest = newestDate(entries);
  const size = `${entries.length} entries, ${(chars / 1024).toFixed(1)} KB`;
  return `${size}${newest ? `, newest ${newest}` : ""}. ${options.fetchHint}`;
}

/**
 * The table of contents (plus keyword index) for `entries`, whatever the
 * store's size; also what a fetch for an unknown id answers with.
 */
export function renderContents(
  entries: readonly MemoryEntry[],
  chars: number,
  options: DigestOptions,
): string {
  const ordered =
    options.order === "newest" ? [...entries].reverse() : [...entries];
  const shown = ordered.slice(0, TOC_MAX_ENTRIES);
  const hidden = ordered.length - shown.length;
  const keywords = keywordLines(shown);
  return [
    summaryLine(entries, chars, options),
    "",
    `Contents${options.order === "newest" ? " (newest first)" : ""}:`,
    "",
    ...shown.map((entry) => contentsLine(entry, options)),
    ...(hidden > 0 ? [`- … ${hidden} more; ${options.overflowHint}`] : []),
    ...(keywords.length ? ["", "Keywords:", "", ...keywords] : []),
  ].join("\n");
}

/** One store a fetch-by-id looks in. */
export interface EntrySource {
  label: string;
  content: string;
  format: EntryFormat;
  options: DigestOptions;
}

function quotedIds(ids: readonly string[]): string {
  return ids.map((id) => `\`${id}\``).join(", ");
}

function currentContents(source: EntrySource): string {
  const entries = parseEntries(source.content, source.format);
  const body = entries.length
    ? renderContents(entries, source.content.trim().length, source.options)
    : "(empty)";
  return `## ${source.label}\n\n${body}`;
}

/**
 * The entries named by a comma-separated `entry` parameter across `sources`.
 * When none match (e.g. an id gone stale after a write), it is rejected with
 * the current contents so the agent can pick again.
 */
export function fetchEntries(
  sources: readonly EntrySource[],
  param: string,
): MemoryExecuteResult {
  const ids = entryIds(param);
  const found = sources.flatMap((source) =>
    findEntries(parseEntries(source.content, source.format), ids).found.map(
      (entry) => ({ label: source.label, entry }),
    ),
  );
  const missing = ids.filter((id) => !found.some((hit) => hit.entry.id === id));
  if (found.length === 0) {
    return {
      error: true,
      text: [
        `No entry ${quotedIds(ids)} found. Current contents:`,
        ...sources.map(currentContents),
      ].join("\n\n"),
    };
  }
  return {
    text: [
      ...found.map(
        ({ label, entry }) => `## ${label}: \`${entry.id}\`\n\n${entry.text}`,
      ),
      ...(missing.length ? [`Not found: ${quotedIds(missing)}.`] : []),
    ].join("\n\n"),
  };
}

/** A store's text as injected, and how it was rendered. */
export interface Digest {
  text: string;
  stats: MemoryDigestStats;
}

/**
 * A store as injected into a prompt: empty, its full text when small, or its
 * table of contents and keyword index, so a large store never loses its newest
 * entries to a size cap.
 */
export function renderDigest(
  content: string,
  format: EntryFormat,
  options: DigestOptions,
): Digest {
  const text = content.trim();
  const entries = parseEntries(content, format);
  const chars = text.length;
  if (!text) {
    return { text: "", stats: { entries: 0, chars: 0, mode: "empty" } };
  }
  if (chars <= (options.inlineMaxChars ?? INLINE_MAX_CHARS)) {
    return { text, stats: { entries: entries.length, chars, mode: "inline" } };
  }
  return {
    text: renderContents(entries, chars, options),
    stats: { entries: entries.length, chars, mode: "contents" },
  };
}

/**
 * A whole-store read's body: the full text when small, otherwise the same
 * contents list the preamble uses, so an unbounded `read_memory`/`kb_read`
 * never dumps a huge file into the turn.
 */
export function renderWholeStore(
  content: string,
  format: EntryFormat,
  options: DigestOptions,
): string {
  return renderDigest(content, format, options).text || "(empty)";
}
