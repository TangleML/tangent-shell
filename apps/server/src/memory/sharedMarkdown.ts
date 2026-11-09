import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { type Digest, renderDigest } from "./memoryDigest.ts";
import { canonicalPath, isStrictlyInside } from "./paths.ts";
import type {
  AgentRole,
  MemoryBackend,
  MemoryContext,
  MemorySourceInfo,
  MemoryToolSpec,
} from "./types.ts";

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

  private get editPath(): string {
    return `${this.label}/${SHARED_MEMORY_FILENAME}`;
  }

  init(): void {
    // Nothing to seed: the file is authored by agents with their file tools.
  }

  /** The note's raw text (line ranges must match the file), `undefined` when
   * it doesn't exist, or `""` when it can't be read safely. */
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
      return readFileSync(file, "utf8");
    } catch {
      return "";
    }
  }

  private digest(content: string): Digest {
    return renderDigest(content, "headings", {
      fetchHint: `Read a section's line range from \`${this.editPath}\` with your file tools.`,
      order: "file",
      showLines: true,
      overflowHint: `read \`${this.editPath}\` with your file tools`,
    });
  }

  preamble(): string {
    const content = this.readNote();
    const body =
      content === undefined
        ? "(not created yet)"
        : this.digest(content).text || "(the note is empty)";
    return [`### Project note \`${this.editPath}\``, "", body].join("\n");
  }

  describe(_ctx: MemoryContext, role: AgentRole): MemorySourceInfo[] {
    const isPrime = role === "prime";
    const content = this.readNote();
    const missingNote =
      "It doesn't exist yet: when there is something durable to record, " +
      "create it with your file tools; it then becomes standing context for this project.";
    return [
      {
        title: "Project note",
        scope: "project",
        holds: `Standing context for this project, kept in \`${this.editPath}\`.`,
        read: { file: this.editPath },
        ...(isPrime ? { write: { file: this.editPath } } : {}),
        notes: content === undefined && isPrime ? [missingNote] : [],
        digest:
          content === undefined
            ? { entries: 0, chars: 0, mode: "empty" }
            : this.digest(content).stats,
      },
    ];
  }

  tools(): MemoryToolSpec[] {
    return [];
  }

  async execute(): Promise<undefined> {
    return undefined;
  }
}
