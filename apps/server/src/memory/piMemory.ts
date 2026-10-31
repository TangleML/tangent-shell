import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

import type { PiMemoryConfig } from "@tangent/shared/contracts.ts";

import type {
  AgentRole,
  MemoryBackend,
  MemoryContext,
  MemorySpawnExtras,
  MemoryToolSpec,
} from "./types.ts";

/** The pi-memory package entry, resolved once (it is a `.ts` Pi extension). */
const PI_MEMORY_ENTRY = createRequire(import.meta.url).resolve("pi-memory");

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

/** Maps a {@link PiMemoryConfig} onto the pi-memory extension's env knobs. Only
 * set fields are emitted (toggles like `exitSummary`/`search` only when
 * disabling; `snapshot`/`qmdUpdate` whenever present), so a config-less binding
 * ("max memory power") ships an empty object. */
function configEnv(config: PiMemoryConfig | undefined): Record<string, string> {
  if (!config) return {};
  const raw: Record<string, string | undefined> = {
    PI_MEMORY_EXIT_SUMMARY: config.exitSummary === false ? "0" : undefined,
    PI_MEMORY_SNAPSHOT: config.snapshot,
    PI_MEMORY_QMD_UPDATE: config.qmdUpdate,
    PI_MEMORY_NO_SEARCH: config.search === false ? "1" : undefined,
    PI_MEMORY_EXIT_SUMMARY_MODEL: config.exitSummaryModel,
  };
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * The pi-memory leaf: binds the `pi-memory` npm extension to a directory as a
 * session's project memory root. It owns its tools' `execute` inside the Pi
 * process (they are NOT dispatcher-backed), so it contributes none of the
 * server's {@link MemoryToolSpec}s — instead it spawns the extension, sets
 * `PI_MEMORY_DIR` to its directory, and allowlists the extension's tools by role.
 * Its hooks (snapshot injection, exit summary, qmd upkeep) run inside that
 * process, scoped to {@link dir}; "one memory shared folder per session" keeps
 * the single global qmd collection unambiguous.
 */
export class PiMemory implements MemoryBackend {
  readonly kind = "pi-memory";
  private readonly dir: string;
  private readonly config: PiMemoryConfig | undefined;

  constructor(dir: string, config?: PiMemoryConfig) {
    this.dir = dir;
    this.config = config;
  }

  init(): void {
    try {
      mkdirSync(this.dir, { recursive: true });
    } catch (err) {
      console.error(
        `[memory] failed to ensure pi-memory dir ${this.dir}:`,
        err,
      );
    }
  }

  preamble(): string {
    return [
      "## Project memory (pi-memory)",
      "",
      "This session is bound to a persistent project memory store. Durable",
      "facts, decisions, and context are recalled for you at the start of a turn",
      "and you curate them with the `memory_*` tools (and `scratchpad`). Consult",
      "`memory_search` before claiming you don't know something about this",
      "project, and record durable learnings with `memory_write`.",
    ].join("\n");
  }

  /** pi-memory owns its tools inside the Pi process, so no dispatcher specs. */
  tools(): MemoryToolSpec[] {
    return [];
  }

  spawn(_ctx: MemoryContext, role: AgentRole): MemorySpawnExtras {
    const searchDisabled = this.config?.search === false;
    const base = role === "prime" ? PRIME_TOOLS : SUBAGENT_TOOLS;
    const allowlistTools = base.filter(
      (name) => !(searchDisabled && name === "memory_search"),
    );
    return {
      env: { PI_MEMORY_DIR: this.dir, ...configEnv(this.config) },
      extensionPaths: [PI_MEMORY_ENTRY],
      allowlistTools: [...allowlistTools],
    };
  }

  /** pi-memory tools are not dispatcher-backed; nothing to execute server-side. */
  execute(): undefined {
    return undefined;
  }
}
