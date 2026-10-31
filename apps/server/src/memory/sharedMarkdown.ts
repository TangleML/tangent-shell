import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { canonicalPath, isStrictlyInside } from "./paths.ts";
import type { MemoryBackend, MemoryToolSpec } from "./types.ts";

/** Filename of the project memory note within the binding's directory. */
const SHARED_MEMORY_FILENAME = "MEMORY.md";

/** Most of the note injected into a system prompt; every mounting session can
 * grow it, and it rides along on every spawn. */
const MAX_NOTE_CHARS = 4000;

/** The note as injected: the whole of it, or its head plus where to read the rest. */
function capNote(content: string, editPath: string): string {
  if (content.length <= MAX_NOTE_CHARS) return content;
  return [
    content.slice(0, MAX_NOTE_CHARS).trimEnd(),
    "",
    `… (truncated; read the full note at \`${editPath}\`)`,
  ].join("\n");
}

/**
 * A `simple-md` binding with a `root`: a single `MEMORY.md` under that directory,
 * injected as standing context. There are no dispatcher tools — agents read and
 * edit the file with their ordinary file tools, so the server stays out of the
 * write path and this leaf only contributes the preamble. When `root` points at
 * a mounted shared folder, the note is shared across every session that mounts
 * it; otherwise it is local to the session.
 */
export class SharedMarkdownMemory implements MemoryBackend {
  readonly kind = "simple-md";
  private readonly dir: string;
  private readonly label: string;

  /**
   * @param dir absolute directory holding `MEMORY.md`
   * @param label the session-root-relative path shown to the agent (e.g.
   * `<mountName>` for a mounted folder)
   */
  constructor(dir: string, label: string) {
    this.dir = dir;
    this.label = label;
  }

  private file(): string {
    return path.join(this.dir, SHARED_MEMORY_FILENAME);
  }

  init(): void {
    // Nothing to seed: the file is authored by agents with their file tools.
  }

  private readNote(): string | undefined {
    const file = this.file();
    if (!existsSync(file)) return undefined;
    if (!isStrictlyInside(canonicalPath(file), canonicalPath(this.dir))) {
      console.warn(
        `[memory] ${file} links outside its folder; not injecting it`,
      );
      return "";
    }
    try {
      return readFileSync(file, "utf8").trim();
    } catch {
      return "";
    }
  }

  preamble(): string {
    const editPath = `${this.label}/${SHARED_MEMORY_FILENAME}`;
    const content = this.readNote();
    if (content === undefined) {
      return [
        "## Project memory",
        "",
        "No project memory note exists yet. When there is something durable to",
        `record, create \`${editPath}\` with your file tools; it then becomes`,
        "authoritative standing context for this project.",
      ].join("\n");
    }
    return [
      "## Project memory",
      "",
      `This project has a memory note at \`${editPath}\`. Treat it as`,
      "authoritative standing context and keep it current by editing that file",
      "with your file tools.",
      "",
      content ? capNote(content, editPath) : "(the note is empty)",
    ].join("\n");
  }

  tools(): MemoryToolSpec[] {
    return [];
  }

  execute(): undefined {
    return undefined;
  }
}
