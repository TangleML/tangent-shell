import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { ENTRY_STAMP, titledEntry } from "./memoryDigest.ts";
import { canonicalPath, isStrictlyInside } from "./paths.ts";
import { qmdStateDir, writeQmdConfig } from "./qmdState.ts";

export const KB_MEMORY_FILENAME = "MEMORY.md";
const DAILY_DIRNAME = "daily";
const AUDIT_FILENAME = ".audit.jsonl";

/** Refused above this so a vague match can't wipe the shared store. */
export const MAX_FORGET_BLOCKS = 5;

export type KbTarget = "long_term" | "daily";

/** A bundle `memory/*.md` file copied into a new store. */
export interface KbSeedFile {
  name: string;
  content: string;
}

export interface KbAppend {
  target: KbTarget;
  /** Written as the entry's `### title` line, shown in the contents list. */
  title?: string;
  content: string;
  tags?: readonly string[];
  sessionId: string;
}

export type KbForgetResult =
  | { kind: "removed"; blocks: string[] }
  | { kind: "too-many"; count: number };

export interface KbAuditEntry {
  sessionId: string;
  tool: string;
  text: string | string[];
}

function readOr(file: string): string {
  try {
    return existsSync(file) ? readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
}

/** `YYYY-MM-DD HH:MM:SS` (UTC), pi-memory's stamp format. */
function stampTime(now: Date): string {
  return now.toISOString().slice(0, 19).replace("T", " ");
}

/** Lines grouped at each stamp, so a stamped entry is one section. */
function sections(content: string): string[][] {
  const out: string[][] = [[]];
  for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
    if (ENTRY_STAMP.test(line)) out.push([]);
    out[out.length - 1].push(line);
  }
  return out;
}

/** A stamped entry is one block; unstamped text splits into paragraphs. */
function sectionBlocks(lines: string[]): string[] {
  const text = lines.join("\n").trim();
  if (!text) return [];
  if (ENTRY_STAMP.test(lines[0])) return [text];
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

/**
 * Splits `content` into the blocks containing `match` (case-insensitive) and
 * the rest. Mirrors pi-memory's `forgetBlocks`, which can't be imported without
 * running that extension's top-level code.
 */
export function forgetBlocks(
  content: string,
  match: string,
): { kept: string[]; removed: string[] } {
  const needle = match.trim().toLowerCase();
  const blocks = sections(content).flatMap(sectionBlocks);
  const hits = (block: string) => block.toLowerCase().includes(needle);
  return {
    kept: blocks.filter((block) => !hits(block)),
    removed: blocks.filter(hits),
  };
}

/**
 * One bundle's knowledge base on disk, in pi-memory's layout (`MEMORY.md`,
 * `daily/<date>.md`, stamped entries). The server is the only writer and every
 * operation is synchronous, so writes from many sessions never interleave.
 */
export class BundleKbStore {
  readonly id: string;
  readonly dir: string;
  readonly stateDir: string;

  /** @param dir the store directory; canonicalized once so a relink can't move it */
  constructor(id: string, dir: string) {
    this.id = id;
    this.dir = canonicalPath(dir);
    this.stateDir = qmdStateDir(this.dir);
  }

  private memoryFile(): string {
    return path.join(this.dir, KB_MEMORY_FILENAME);
  }

  exists(): boolean {
    return existsSync(this.dir);
  }

  /** Creates the store and (re)writes its qmd config. */
  ensure(): void {
    mkdirSync(this.dir, { recursive: true });
    writeQmdConfig(this.stateDir, this.dir);
  }

  /** Creates the store from `files` unless it already exists; true when seeded. */
  seedIfNew(files: readonly KbSeedFile[]): boolean {
    if (this.exists()) return false;
    this.ensure();
    for (const file of files) {
      const name = path.basename(file.name);
      if (!name.endsWith(".md")) continue;
      writeFileSync(path.join(this.dir, name), file.content);
    }
    return true;
  }

  /** The long-term note, trimmed; empty when absent. */
  readMemory(): string {
    return readOr(this.memoryFile()).trim();
  }

  /** Appends a stamped entry; returns the store-relative file written. */
  append(entry: KbAppend, now = new Date()): string {
    const rel =
      entry.target === "daily"
        ? path.join(DAILY_DIRNAME, `${now.toISOString().slice(0, 10)}.md`)
        : KB_MEMORY_FILENAME;
    const file = path.join(this.dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });

    const body = titledEntry(entry.title, entry.content, entry.tags);
    const stamp = `<!-- ${stampTime(now)} [${entry.sessionId.slice(0, 8)}] -->`;
    const existing = readOr(file).trimEnd();
    const separator = existing ? "\n\n" : "";
    writeFileSync(file, `${existing}${separator}${stamp}\n${body}\n`);
    return rel;
  }

  /** Removes every `MEMORY.md` block containing `match`, up to {@link MAX_FORGET_BLOCKS}. */
  forget(match: string): KbForgetResult {
    const { kept, removed } = forgetBlocks(this.readMemory(), match);
    if (removed.length > MAX_FORGET_BLOCKS) {
      return { kind: "too-many", count: removed.length };
    }
    if (removed.length > 0) {
      writeFileSync(
        this.memoryFile(),
        kept.length ? `${kept.join("\n\n")}\n` : "",
      );
    }
    return { kind: "removed", blocks: removed };
  }

  /** A markdown file's text, or undefined when `rel` names none inside the store. */
  read(rel: string): string | undefined {
    if (!rel.endsWith(".md")) return undefined;
    const file = canonicalPath(path.resolve(this.dir, rel));
    if (!isStrictlyInside(file, this.dir) || !existsSync(file)) {
      return undefined;
    }
    return readOr(file);
  }

  /** Store-relative paths of every markdown file, sorted. */
  listFiles(): string[] {
    if (!this.exists()) return [];
    return readdirSync(this.dir, { recursive: true, encoding: "utf8" })
      .filter((rel) => rel.endsWith(".md"))
      .sort();
  }

  /** Records who changed what; qmd skips it (not markdown). */
  audit(entry: KbAuditEntry, now = new Date()): void {
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(
      path.join(this.dir, AUDIT_FILENAME),
      `${JSON.stringify({ ts: now.toISOString(), ...entry })}\n`,
    );
  }
}
