import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { PiMemoryConfig } from "@tangent/shared/contracts.ts";

import { canonicalPath } from "./paths.ts";
import { findLocalQmdConfig, qmdStateDir, writeQmdConfig } from "./qmdState.ts";
import type {
  AgentRole,
  MemoryBackend,
  MemoryContext,
  MemorySpawnExtras,
  MemoryToolSpec,
} from "./types.ts";

/** Tools pi-memory registers. Writes are Prime-only; reads/search/status are
 * offered to sub-agents too (they recall, they don't curate). */
const PRIME_TOOLS = [
  "memory_write",
  "memory_forget",
  "memory_restore",
  "memory_read",
  "scratchpad",
  "memory_search",
  "memory_status",
] as const;
const SUBAGENT_TOOLS = [
  "memory_read",
  "memory_search",
  "memory_status",
] as const;

/** Sub-agents only recall: no exit summary appended to the shared daily log and
 * no index upkeep from their processes. */
const SUBAGENT_ENV = {
  PI_MEMORY_EXIT_SUMMARY: "0",
  PI_MEMORY_QMD_UPDATE: "off",
} as const;

let piMemoryEntry: string | undefined;

/**
 * The pi-memory package entry (a `.ts` Pi extension). Resolved on first use, not
 * at module load, so an image without the package still boots and only sessions
 * that bind pi-memory fail to resolve it.
 */
function piMemoryEntryPath(): string {
  piMemoryEntry ??= createRequire(import.meta.url).resolve("pi-memory");
  return piMemoryEntry;
}

/** Whether the `pi-memory` package resolves in this install. */
export function piMemoryInstalled(): boolean {
  try {
    piMemoryEntryPath();
    return true;
  } catch {
    return false;
  }
}

/**
 * Maps a {@link PiMemoryConfig} onto the pi-memory extension's env knobs. Only
 * set fields are emitted, so a config-less binding gets pi-memory's own "max
 * memory power" defaults; the spawn strips inherited `PI_MEMORY_*` values.
 */
function configEnv(config: PiMemoryConfig = {}): Record<string, string> {
  const raw: Record<string, string | undefined> = {
    PI_MEMORY_EXIT_SUMMARY: config.exitSummary === false ? "0" : undefined,
    PI_MEMORY_SNAPSHOT: config.snapshot,
    PI_MEMORY_QMD_UPDATE: config.qmdUpdate,
    PI_MEMORY_NO_SEARCH: config.search === false ? "1" : undefined,
    PI_MEMORY_EXIT_SUMMARY_MODEL: config.exitSummaryModel,
  };
  return Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

/**
 * The pi-memory leaf: binds the `pi-memory` npm extension to a directory as a
 * session's project memory root. It owns its tools' `execute` inside the Pi
 * process (they are NOT dispatcher-backed), so it contributes none of the
 * server's {@link MemoryToolSpec}s — instead it spawns the extension, sets
 * `PI_MEMORY_DIR` to its directory, and allowlists the extension's tools by role.
 * Its hooks (snapshot injection, exit summary, qmd upkeep) run inside that
 * process, scoped to {@link dir} and its own server-owned qmd index (pi-memory
 * hard-codes one collection name, so each store needs its own index).
 */
export class PiMemory implements MemoryBackend {
  readonly kind = "pi-memory";
  private readonly dir: string;
  private readonly qmdDir: string;
  private readonly config: PiMemoryConfig | undefined;
  private readonly label: string | undefined;
  private readonly entry: string;

  private reportedStrayConfig: string | undefined;

  /**
   * @param dir the store's canonical path, resolved once by the caller and
   * never re-resolved, so relinking the workspace path can't move the store
   * @param label the session-root-relative store path shown to the agent
   * @throws when the `pi-memory` package is not installed.
   */
  constructor(dir: string, config?: PiMemoryConfig, label?: string) {
    this.dir = dir;
    this.qmdDir = qmdStateDir(dir);
    this.config = config;
    this.label = label;
    this.entry = piMemoryEntryPath();
  }

  private get searchDisabled(): boolean {
    return this.config?.search === false;
  }

  /**
   * True when a project-local qmd config at or above the session root (qmd's
   * working directory) would override the store's index. Checked on every
   * spawn since agents can write the session root; pi-memory registers its
   * collection on start whatever the search knobs say, so the leaf is left out
   * rather than degraded.
   */
  private blockedByStrayConfig(ctx: MemoryContext): boolean {
    const stray = findLocalQmdConfig(ctx.rootPath);
    if (stray && stray !== this.reportedStrayConfig) {
      console.error(
        `[memory] qmd would use the project-local config ${stray} instead of this store's index; leaving pi-memory out until it is removed`,
      );
    }
    this.reportedStrayConfig = stray;
    return stray !== undefined;
  }

  init(): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      writeQmdConfig(this.qmdDir, this.dir);
    } catch (err) {
      console.error(
        `[memory] failed to prepare pi-memory store ${this.dir}:`,
        err,
      );
    }
  }

  preamble(ctx: MemoryContext, role: AgentRole): string {
    if (this.blockedByStrayConfig(ctx)) return "";
    const lookup = this.searchDisabled ? "`memory_read`" : "`memory_search`";
    const lines = [
      "## Project memory (pi-memory)",
      "",
      "This session is bound to a persistent project memory store. Durable",
      "facts, decisions, and context are recalled for you at the start of a turn.",
      `Consult ${lookup} before claiming you don't know something about this`,
      "project.",
      ...this.locationLines(ctx),
    ];
    if (role === "prime") {
      lines.push(
        "You curate the store with the `memory_*` tools (and `scratchpad`):",
        "record durable learnings with `memory_write`.",
      );
    } else {
      lines.push(
        "The store is read-only for you: report durable learnings to Prime",
        "instead of trying to write them.",
      );
    }
    return lines.join("\n");
  }

  /** Where the store lives, reconciling the workspace path with the canonical
   * one pi-memory's tools report for a mounted store. */
  private locationLines(ctx: MemoryContext): string[] {
    if (!this.label) return [];
    const where = `The store's files live under \`${this.label}/\` in your workspace.`;
    const workspacePath = path.join(canonicalPath(ctx.rootPath), this.label);
    if (workspacePath === this.dir) return [where];
    return [
      where,
      `pi-memory tools report them by their canonical path \`${this.dir}/\`;`,
      "both paths name the same files.",
    ];
  }

  /** pi-memory owns its tools inside the Pi process, so no dispatcher specs. */
  tools(): MemoryToolSpec[] {
    return [];
  }

  spawn(ctx: MemoryContext, role: AgentRole): MemorySpawnExtras {
    if (this.blockedByStrayConfig(ctx)) return {};
    const base = role === "prime" ? PRIME_TOOLS : SUBAGENT_TOOLS;
    const allowlistTools = base.filter(
      (name) => !(this.searchDisabled && name === "memory_search"),
    );
    return {
      env: {
        PI_MEMORY_DIR: this.dir,
        INDEX_PATH: path.join(this.qmdDir, "index.sqlite"),
        QMD_CONFIG_DIR: this.qmdDir,
        ...configEnv(this.config),
        ...(role === "prime" ? {} : SUBAGENT_ENV),
      },
      extensionPaths: [this.entry],
      allowlistTools: [...allowlistTools],
    };
  }

  /** pi-memory tools are not dispatcher-backed; nothing to execute server-side. */
  execute(): undefined {
    return undefined;
  }
}
