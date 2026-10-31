import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { MemoryBackend, MemoryToolSpec } from "./types.ts";

/** Filename of the project memory note within the binding's directory. */
const SHARED_MEMORY_FILENAME = "MEMORY.md";

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

  preamble(): string {
    const file = this.file();
    const content =
      existsSync(file) &&
      (() => {
        try {
          return readFileSync(file, "utf8").trim();
        } catch {
          return "";
        }
      })();
    const editPath = `${this.label}/${SHARED_MEMORY_FILENAME}`;
    return [
      "## Project memory",
      "",
      `This project has a memory note at \`${editPath}\`. Treat it as`,
      "authoritative standing context and keep it current by editing that file",
      "with your file tools.",
      "",
      content ? content : `(empty — create \`${editPath}\` when it's useful)`,
    ].join("\n");
  }

  tools(): MemoryToolSpec[] {
    return [];
  }

  execute(): undefined {
    return undefined;
  }
}
