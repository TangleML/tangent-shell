import {
  DEFAULT_SEARCH_LIMIT,
  forgetParamsSchema,
  formatHit,
  readParamsSchema,
  searchParamsSchema,
  writeParamsSchema,
} from "./bundleKbParams.ts";
import type { BundleKbRegistry } from "./bundleKbRegistry.ts";
import {
  type BundleKbStore,
  KB_MEMORY_FILENAME,
  MAX_FORGET_BLOCKS,
} from "./bundleKbStore.ts";
import {
  type Digest,
  type EntrySource,
  fetchEntries,
  renderDigest,
} from "./memoryDigest.ts";
import { invalidParams, rejected } from "./toolResults.ts";
import type {
  AgentRole,
  MemoryBackend,
  MemoryContext,
  MemoryExecuteResult,
  MemorySourceInfo,
  MemoryToolSpec,
} from "./types.ts";

/** Dispatcher tools; their copy and schemas live in `pi/extensions/memory.ts`. */
const SEARCH_TOOL = "kb_search";
const READ_TOOL = "kb_read";
const WRITE_TOOL = "kb_write";
const FORGET_TOOL = "kb_forget";

const READ_TOOLS = [SEARCH_TOOL, READ_TOOL];
const WRITE_TOOLS = [WRITE_TOOL, FORGET_TOOL];
const ALL_TOOLS = new Set([...READ_TOOLS, ...WRITE_TOOLS]);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The `bundle-kb` leaf: the knowledge base shared by every session of one
 * bundle. Its tools are dispatcher-backed, so the server performs every read,
 * search, and write against the store; sub-agents may only search and read.
 */
export class BundleKnowledgeMemory implements MemoryBackend {
  readonly kind = "bundle-kb";
  private readonly store: BundleKbStore;
  private readonly registry: BundleKbRegistry;

  constructor(store: BundleKbStore, registry: BundleKbRegistry) {
    this.store = store;
    this.registry = registry;
  }

  init(): void {
    try {
      this.store.ensure();
    } catch (err) {
      console.error(
        `[memory] failed to prepare bundle store ${this.store.id}:`,
        err,
      );
    }
  }

  private entrySource(): EntrySource {
    return {
      label: KB_MEMORY_FILENAME,
      content: this.store.readMemory(),
      format: "stamped",
      options: {
        fetchHint: `Fetch entries with \`${READ_TOOL} { entry: "<id>" }\` (comma-separate several).`,
        order: "newest",
        overflowHint: `search with \`${SEARCH_TOOL}\``,
      },
    };
  }

  private digest(): Digest {
    const source = this.entrySource();
    return renderDigest(source.content, source.format, source.options);
  }

  preamble(): string {
    return [
      `### Bundle knowledge base: ${KB_MEMORY_FILENAME}`,
      "",
      this.digest().text || "(empty)",
    ].join("\n");
  }

  describe(_ctx: MemoryContext, role: AgentRole): MemorySourceInfo[] {
    const isPrime = role === "prime";
    return [
      {
        title: "Bundle knowledge base",
        scope: "bundle",
        holds:
          "Domain knowledge every session of this bundle shares, separate " +
          "from this session's project and session memory.",
        read: { tools: READ_TOOLS },
        ...(isPrime ? { write: { tools: WRITE_TOOLS } } : {}),
        notes: [
          `Search it with \`${SEARCH_TOOL}\` (keyword, semantic, or deep); daily logs are only found by search.`,
          ...(isPrime
            ? [
                `\`${WRITE_TOOL}\` appends a titled, tagged entry and \`${FORGET_TOOL}\` removes wrong ones. ` +
                  "Every user of this bundle reads it, so never store session-specific notes, secrets, or personal data.",
              ]
            : []),
        ],
        digest: this.digest().stats,
      },
    ];
  }

  tools(role: AgentRole): MemoryToolSpec[] {
    const names =
      role === "prime" ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS;
    return names.map((name) => ({ name }));
  }

  async execute(
    name: string,
    params: Record<string, unknown>,
    ctx: MemoryContext,
    role: AgentRole,
  ): Promise<MemoryExecuteResult | undefined> {
    if (!ALL_TOOLS.has(name)) return undefined;
    if (WRITE_TOOLS.includes(name) && role !== "prime") {
      return rejected(
        `${name} is Prime-only; report bundle-wide learnings to Prime instead.`,
      );
    }
    try {
      return await this.dispatch(name, params, ctx);
    } catch (err) {
      return rejected(`${name} failed: ${errorMessage(err)}`);
    }
  }

  private dispatch(
    name: string,
    params: Record<string, unknown>,
    ctx: MemoryContext,
  ): Promise<MemoryExecuteResult> | MemoryExecuteResult {
    if (name === SEARCH_TOOL) return this.search(params);
    if (name === READ_TOOL) return this.read(params);
    if (name === WRITE_TOOL) return this.write(params, ctx);
    return this.forget(params, ctx);
  }

  private async search(
    params: Record<string, unknown>,
  ): Promise<MemoryExecuteResult> {
    const parsed = searchParamsSchema.safeParse(params);
    if (!parsed.success) return invalidParams(SEARCH_TOOL, parsed.error);
    const {
      query,
      mode = "keyword",
      limit = DEFAULT_SEARCH_LIMIT,
    } = parsed.data;
    const hits = await this.registry.runner.search(
      this.store.stateDir,
      mode,
      query,
      limit,
    );
    if (hits.length === 0) {
      return { text: `No ${mode} results for "${query}".` };
    }
    return {
      text: [
        `${hits.length} ${mode} result(s) for "${query}":`,
        "",
        hits.map(formatHit).join("\n\n"),
      ].join("\n"),
    };
  }

  private read(params: Record<string, unknown>): MemoryExecuteResult {
    const parsed = readParamsSchema.safeParse(params);
    if (!parsed.success) return invalidParams(READ_TOOL, parsed.error);
    if (parsed.data.entry) {
      return fetchEntries([this.entrySource()], parsed.data.entry);
    }
    return this.readFile(parsed.data.path ?? KB_MEMORY_FILENAME);
  }

  private readFile(rel: string): MemoryExecuteResult {
    const content =
      rel === KB_MEMORY_FILENAME
        ? this.store.readMemory()
        : this.store.read(rel);
    if (content === undefined) {
      return rejected(
        `No markdown file "${rel}" in the knowledge base. Files: ${this.fileList()}`,
      );
    }
    return {
      text: [
        `## ${rel}`,
        "",
        content.trim() || "(empty)",
        "",
        `Files: ${this.fileList()}`,
      ].join("\n"),
    };
  }

  private fileList(): string {
    const files = this.store.listFiles();
    return files.length
      ? files.map((file) => `\`${file}\``).join(", ")
      : "none";
  }

  private write(
    params: Record<string, unknown>,
    ctx: MemoryContext,
  ): MemoryExecuteResult {
    const parsed = writeParamsSchema.safeParse(params);
    if (!parsed.success) return invalidParams(WRITE_TOOL, parsed.error);
    const { title, content, target = "long_term", tags } = parsed.data;
    const rel = this.store.append({
      target,
      title,
      content,
      tags,
      sessionId: ctx.sessionId,
    });
    this.store.audit({
      sessionId: ctx.sessionId,
      tool: WRITE_TOOL,
      text: content,
    });
    this.registry.scheduleReindex(this.store);
    return {
      text:
        `Stored to the bundle knowledge base (\`${rel}\`). Every session of ` +
        "this bundle will see it; the user has been shown exactly what was saved.",
      effects: [{ kind: "remembered", scope: "bundle", text: content }],
    };
  }

  private forget(
    params: Record<string, unknown>,
    ctx: MemoryContext,
  ): MemoryExecuteResult {
    const parsed = forgetParamsSchema.safeParse(params);
    if (!parsed.success) return invalidParams(FORGET_TOOL, parsed.error);
    const result = this.store.forget(parsed.data.match);
    if (result.kind === "too-many") {
      return rejected(
        `"${parsed.data.match}" matches ${result.count} entries; at most ` +
          `${MAX_FORGET_BLOCKS} can be removed at once. Use a more specific match.`,
      );
    }
    if (result.blocks.length === 0) {
      return {
        text: `No ${KB_MEMORY_FILENAME} entry matched "${parsed.data.match}".`,
      };
    }
    this.store.audit({
      sessionId: ctx.sessionId,
      tool: FORGET_TOOL,
      text: result.blocks,
    });
    this.registry.scheduleReindex(this.store);
    return {
      text: [
        `Removed ${result.blocks.length} entr${result.blocks.length === 1 ? "y" : "ies"} from ${KB_MEMORY_FILENAME}:`,
        "",
        ...result.blocks.map((block) => `---\n${block}`),
      ].join("\n"),
    };
  }
}
