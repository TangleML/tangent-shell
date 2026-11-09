import { execFile } from "node:child_process";
import path from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";

import { z } from "zod";

import { findLocalQmdConfig, QMD_COLLECTION } from "./qmdState.ts";

const execFileAsync = promisify(execFile);

/** A first semantic or deep search may load (or download) qmd's models. */
const SEARCH_TIMEOUT_MS = 60_000;
const UPDATE_TIMEOUT_MS = 30_000;
const EMBED_TIMEOUT_MS = 10 * 60_000;
const MAX_BUFFER = 16 * 1024 * 1024;

export type QmdSearchMode = "keyword" | "semantic" | "deep";

const SUBCOMMANDS: Record<QmdSearchMode, string> = {
  keyword: "search",
  semantic: "vsearch",
  deep: "query",
};

export interface QmdExecOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
}

/** Runs `qmd <args>`; injectable so tests never need the binary. */
export type QmdExec = (
  args: readonly string[],
  options: QmdExecOptions,
) => Promise<{ stdout: string }>;

const execQmd: QmdExec = async (args, options) => {
  const { stdout } = await execFileAsync("qmd", [...args], {
    ...options,
    maxBuffer: MAX_BUFFER,
  });
  return { stdout };
};

/** One search hit, its path relative to the store. */
export interface QmdHit {
  path: string;
  score?: number;
  text: string;
}

const rawHitSchema = z.object({
  path: z.string().optional(),
  file: z.string().optional(),
  score: z.number().optional(),
  content: z.string().optional(),
  chunk: z.string().optional(),
  snippet: z.string().optional(),
});

const rawHitsSchema = z.union([
  z.array(z.unknown()),
  z.object({ results: z.array(z.unknown()) }).transform((o) => o.results),
  z.object({ hits: z.array(z.unknown()) }).transform((o) => o.hits),
]);

/** Raised when qmd can't run at all; the message is safe to show agents. */
export class QmdUnavailableError extends Error {}

const COLLECTION_PREFIX = `qmd://${QMD_COLLECTION}/`;

type RawHit = z.infer<typeof rawHitSchema>;

function hitText(hit: RawHit): string {
  return (hit.content ?? hit.chunk ?? hit.snippet ?? "").trim();
}

function storeRelative(location: string): string {
  return location.startsWith(COLLECTION_PREFIX)
    ? location.slice(COLLECTION_PREFIX.length)
    : location;
}

function toHit(raw: unknown): QmdHit | undefined {
  const parsed = rawHitSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const location = parsed.data.path ?? parsed.data.file;
  if (!location) return undefined;
  return {
    path: storeRelative(location),
    score: parsed.data.score,
    text: hitText(parsed.data),
  };
}

/** Parses `qmd --json` output, which may lead with progress lines or say "No results found." */
export function parseQmdHits(stdout: string): QmdHit[] {
  const cleaned = stripVTControlCharacters(stdout);
  const start = cleaned.search(/^\s*[[{]/m);
  if (start === -1) return [];
  const rows = rawHitsSchema.safeParse(JSON.parse(cleaned.slice(start)));
  if (!rows.success) return [];
  return rows.data.map(toHit).filter((hit): hit is QmdHit => hit !== undefined);
}

/** The env and cwd that pin qmd to one store's server-owned index and config. */
function storeOptions(stateDir: string, timeout: number): QmdExecOptions {
  return {
    cwd: stateDir,
    timeout,
    env: {
      ...process.env,
      INDEX_PATH: path.join(stateDir, "index.sqlite"),
      QMD_CONFIG_DIR: stateDir,
    },
  };
}

function isMissingBinary(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/** qmd's own message for a failed run, without the command line or colors. */
function qmdFailure(err: unknown): Error {
  if (isMissingBinary(err)) {
    return new QmdUnavailableError(
      "qmd is not installed on the server, so search is unavailable.",
    );
  }
  const failed = err as { stderr?: string; killed?: boolean; message?: string };
  if (failed.killed) {
    return new Error(
      "qmd timed out; a first semantic or deep search may still be loading models, retry shortly.",
    );
  }
  const detail = stripVTControlCharacters(
    failed.stderr || failed.message || String(err),
  ).trim();
  return new Error(`qmd failed: ${detail}`);
}

/** Runs qmd against a store's index under {@link qmdStateDir}. */
export class QmdRunner {
  private readonly exec: QmdExec;

  constructor(exec: QmdExec = execQmd) {
    this.exec = exec;
  }

  async search(
    stateDir: string,
    mode: QmdSearchMode,
    query: string,
    limit: number,
  ): Promise<QmdHit[]> {
    const args = [
      SUBCOMMANDS[mode],
      "--json",
      "-c",
      QMD_COLLECTION,
      "-n",
      String(limit),
      query,
    ];
    const { stdout } = await this.run(stateDir, args, SEARCH_TIMEOUT_MS);
    return parseQmdHits(stdout);
  }

  async update(stateDir: string): Promise<void> {
    await this.run(stateDir, ["update"], UPDATE_TIMEOUT_MS);
  }

  async embed(stateDir: string): Promise<void> {
    await this.run(stateDir, ["embed"], EMBED_TIMEOUT_MS);
  }

  /** qmd adopts any `.qmd/index.yml` above its cwd over `QMD_CONFIG_DIR`. */
  private async run(
    stateDir: string,
    args: readonly string[],
    timeout: number,
  ): Promise<{ stdout: string }> {
    const stray = findLocalQmdConfig(stateDir);
    if (stray) {
      throw new QmdUnavailableError(
        `qmd would use the stray config ${stray} instead of this store's index.`,
      );
    }
    try {
      return await this.exec(args, storeOptions(stateDir, timeout));
    } catch (err) {
      throw qmdFailure(err);
    }
  }
}

/**
 * Keeps store indexes fresh: each store's `update` + `embed` is debounced after
 * writes, and every run goes through one queue so at most one qmd indexing
 * process runs on the server at a time.
 */
export class QmdIndexer {
  private readonly runner: QmdRunner;
  private readonly debounceMs: number;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly queued = new Set<string>();
  private chain: Promise<void> = Promise.resolve();
  private reportedUnavailable = false;

  constructor(runner: QmdRunner, debounceMs = 5_000) {
    this.runner = runner;
    this.debounceMs = debounceMs;
  }

  /** Reindexes `stateDir` once writes have been quiet for the debounce window. */
  schedule(stateDir: string): void {
    clearTimeout(this.timers.get(stateDir));
    const timer = setTimeout(() => {
      this.timers.delete(stateDir);
      void this.enqueue(stateDir);
    }, this.debounceMs);
    timer.unref();
    this.timers.set(stateDir, timer);
  }

  /** Queues a reindex unless one for `stateDir` is already waiting to start. */
  enqueue(stateDir: string): Promise<void> {
    if (this.queued.has(stateDir)) return this.chain;
    this.queued.add(stateDir);
    this.chain = this.chain.then(() => {
      this.queued.delete(stateDir);
      return this.reindex(stateDir);
    });
    return this.chain;
  }

  /** Resolves once every queued reindex has finished. */
  idle(): Promise<void> {
    return this.chain;
  }

  private async reindex(stateDir: string): Promise<void> {
    try {
      await this.runner.update(stateDir);
      await this.runner.embed(stateDir);
    } catch (err) {
      this.report(stateDir, err);
    }
  }

  private report(stateDir: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    if (!(err instanceof QmdUnavailableError)) {
      console.warn(`[memory] reindexing ${stateDir} failed: ${message}`);
      return;
    }
    if (this.reportedUnavailable) return;
    this.reportedUnavailable = true;
    console.warn(`[memory] bundle knowledge-base indexing is off: ${message}`);
  }
}
