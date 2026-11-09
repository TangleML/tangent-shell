import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { MemoryScope } from "@tangent/shared/contracts.ts";

import {
  GLOBAL_MEMORY_DIR,
  GLOBAL_MEMORY_FILENAME,
  SESSION_MEMORY_FILENAME,
} from "../config.ts";
import {
  type Digest,
  type EntrySource,
  fetchEntries,
  renderDigest,
  titledEntry,
} from "./memoryDigest.ts";
import {
  readMemoryParamsSchema,
  rememberParamsSchema,
  suggestParamsSchema,
} from "./simpleMdParams.ts";
import { invalidParams, rejected } from "./toolResults.ts";
import type {
  AgentRole,
  MemoryBackend,
  MemoryContext,
  MemoryExecuteResult,
  MemorySourceInfo,
  MemoryToolSpec,
} from "./types.ts";

/** A change applied to a memory file, returned so callers can surface it. */
export interface MemoryWriteResult {
  scope: MemoryScope;
  /** The exact text now stored (the file's full contents after the write). */
  stored: string;
  /** The fragment that was added/changed, for the UI highlight. */
  added: string;
}

/** A pending agent-initiated suggestion awaiting the user's confirmation. */
export interface PendingSuggestion {
  id: string;
  sessionId: string;
  scope: MemoryScope;
  text: string;
}

/** Header written when Prime first creates a memory file. */
function header(title: string): string {
  return `# ${title}\n`;
}

/** Reads a UTF-8 file, returning `""` when it doesn't exist. */
function readOr(file: string, fallback = ""): string {
  try {
    return existsSync(file) ? readFileSync(file, "utf8") : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Appends `text` to `current` (or replaces a prior fragment), keeping a single
 * trailing newline. When `replaces` matches a substring of the current content
 * it is swapped in place; otherwise `text` is appended as a new bullet block.
 */
function applyEdit(current: string, text: string, replaces?: string): string {
  const trimmed = text.trim();
  if (replaces && current.includes(replaces)) {
    return `${current.replace(replaces, trimmed)}\n`.replace(/\n+$/, "\n");
  }
  const base = current.trim();
  const next = base ? `${base}\n\n${trimmed}` : trimmed;
  return `${next}\n`;
}

/** The dispatcher tools SimpleMD exposes, by role. Their copy and schemas live
 * in the Pi memory extension (`pi/extensions/memory.ts`). */
const READ_MEMORY_TOOL: MemoryToolSpec = { name: "read_memory" };
const REMEMBER_TOOL: MemoryToolSpec = { name: "remember" };
const SUGGEST_MEMORY_TOOL: MemoryToolSpec = { name: "suggest_memory" };

/** The `# Global memory` / `# Session memory` line a store file starts with. */
const STORE_HEADER = /^\s*# (?:Global|Session) memory[ \t]*(?:\n|$)/;

const SCOPES: readonly MemoryScope[] = ["global", "session"];

/** Tools that change memory (or propose a change); Prime-only. */
const WRITE_TOOLS = new Set([REMEMBER_TOOL.name, SUGGEST_MEMORY_TOOL.name]);

/**
 * The built-in SimpleMD memory backend: a single global store (from
 * {@link GLOBAL_MEMORY_DIR}) injected into every session, and a per-session file
 * at the session root. The server is the sole writer, so the UI's "remembered"
 * highlight is derived from the actual file change rather than the agent's
 * narration (keeping the agent honest).
 *
 * Implements {@link MemoryBackend} (for the resolver/composite) and keeps the
 * imperative API ({@link write}, {@link replaceGlobal}, suggestions, …) the
 * global-memory route, chat handlers, and host-resource writes still call.
 */
export class SimpleMdMemory implements MemoryBackend {
  readonly kind = "simple-md";

  /** Agent-initiated suggestions awaiting user confirmation, keyed by id. */
  private readonly suggestions = new Map<string, PendingSuggestion>();

  /** Absolute path to the canonical global memory file. */
  private globalFile(): string {
    return path.join(GLOBAL_MEMORY_DIR, GLOBAL_MEMORY_FILENAME);
  }

  /** Absolute path to a session's canonical memory file. */
  private sessionFile(rootPath: string): string {
    return path.join(rootPath, SESSION_MEMORY_FILENAME);
  }

  /** Absolute path to a session's read-only global memory snapshot. */
  private sessionGlobalSnapshot(rootPath: string): string {
    return path.join(rootPath, GLOBAL_MEMORY_FILENAME);
  }

  /**
   * Prepares memory for a session: ensures the global store exists and copies a
   * read-only snapshot of it into the session root so the agent can read it
   * with its own file tools. The session memory file is intentionally NOT
   * created here — Prime creates it on its first `remember` (per the spec).
   */
  initSession(rootPath: string): void {
    this.ensureGlobalFile();
    try {
      writeFileSync(this.sessionGlobalSnapshot(rootPath), this.readGlobal());
    } catch (err) {
      console.error(`[memory] failed to snapshot global memory:`, err);
    }
  }

  /** {@link MemoryBackend.init}: prepares the session's SimpleMD stores. */
  init(ctx: MemoryContext): void {
    this.initSession(ctx.rootPath);
  }

  /** Creates {@link GLOBAL_MEMORY_DIR} and a seeded file if missing. */
  private ensureGlobalFile(): void {
    try {
      mkdirSync(GLOBAL_MEMORY_DIR, { recursive: true });
      if (!existsSync(this.globalFile())) {
        writeFileSync(this.globalFile(), header("Global memory"));
      }
    } catch (err) {
      console.error(`[memory] failed to ensure global memory file:`, err);
    }
  }

  /** Current global memory text (empty string when unset). */
  readGlobal(): string {
    return readOr(this.globalFile());
  }

  /** Current session memory text (empty string when Prime hasn't created it). */
  readSession(rootPath: string): string {
    return readOr(this.sessionFile(rootPath));
  }

  /** A store's entries, without the header line its file starts with. */
  private entrySource(rootPath: string, scope: MemoryScope): EntrySource {
    const raw =
      scope === "global" ? this.readGlobal() : this.readSession(rootPath);
    return {
      label: `${scope === "global" ? "Global" : "Session"} memory`,
      content: raw.replace(STORE_HEADER, ""),
      format: "headings",
      options: {
        fetchHint: `Fetch entries with \`read_memory { scope: "${scope}", entry: "<id>" }\` (comma-separate several).`,
        order: "newest",
        overflowHint: `read them all with \`read_memory { scope: "${scope}" }\``,
      },
    };
  }

  private digest(rootPath: string, scope: MemoryScope): Digest {
    const source = this.entrySource(rootPath, scope);
    return renderDigest(source.content, source.format, source.options);
  }

  /**
   * The global and session memory digests appended to every agent's system
   * prompt, so memory is available from the first turn of every session. How
   * to read and write them is in {@link describe}.
   */
  buildPreamble(rootPath: string): string {
    return [
      "### Global memory",
      "",
      this.digest(rootPath, "global").text || "(empty)",
      "",
      "### Session memory",
      "",
      this.digest(rootPath, "session").text || "(empty)",
    ].join("\n");
  }

  /** {@link MemoryBackend.preamble}. */
  preamble(ctx: MemoryContext): string {
    return this.buildPreamble(ctx.rootPath);
  }

  /** {@link MemoryBackend.describe}: only Prime is told how to write. */
  describe(ctx: MemoryContext, role: AgentRole): MemorySourceInfo[] {
    const isPrime = role === "prime";
    const read = { tools: [READ_MEMORY_TOOL.name] };
    const session = this.digest(ctx.rootPath, "session");
    const sessionNotes = [
      ...(session.stats.mode === "empty"
        ? ["Empty: create it with `remember` when useful."]
        : []),
      "Give each fact a short `title` (and `tags`). To revise one, fetch it " +
        "with `read_memory { entry }` and pass its full text as `replaces`.",
    ];
    return [
      {
        title: "Global memory",
        scope: "global",
        holds: "Preferences and facts that apply to every session.",
        read,
        ...(isPrime
          ? {
              write: { tools: [SUGGEST_MEMORY_TOOL.name, REMEMBER_TOOL.name] },
              notes: [
                "Propose global facts with `suggest_memory`; write them with " +
                  '`remember` (scope "global") only when the user explicitly asks.',
              ],
            }
          : {}),
        digest: this.digest(ctx.rootPath, "global").stats,
      },
      {
        title: "Session memory",
        scope: "session",
        holds: "Facts and working agreements for this session only.",
        read,
        ...(isPrime
          ? { write: { tools: [REMEMBER_TOOL.name] }, notes: sessionNotes }
          : {}),
        digest: session.stats,
      },
    ];
  }

  /** {@link MemoryBackend.tools}: read for everyone, writes for Prime only. */
  tools(role: AgentRole): MemoryToolSpec[] {
    if (role === "prime") {
      return [READ_MEMORY_TOOL, REMEMBER_TOOL, SUGGEST_MEMORY_TOOL];
    }
    return [READ_MEMORY_TOOL];
  }

  /** {@link MemoryBackend.execute}: dispatches one SimpleMD dispatcher tool. */
  async execute(
    name: string,
    params: Record<string, unknown>,
    ctx: MemoryContext,
    role: AgentRole,
  ): Promise<MemoryExecuteResult | undefined> {
    if (WRITE_TOOLS.has(name) && role !== "prime") {
      return rejected(
        `${name} is Prime-only; ask Prime to store durable facts for you.`,
      );
    }
    if (name === "read_memory") return this.executeRead(params, ctx);
    if (name === "remember") return this.executeRemember(params, ctx);
    if (name === "suggest_memory") return this.executeSuggest(params, ctx);
    return undefined;
  }

  private executeRead(
    params: Record<string, unknown>,
    ctx: MemoryContext,
  ): MemoryExecuteResult {
    const parsed = readMemoryParamsSchema.safeParse(params);
    if (!parsed.success) return invalidParams("read_memory", parsed.error);
    const { scope, entry } = parsed.data;
    const sources = (scope ? [scope] : SCOPES).map((each) =>
      this.entrySource(ctx.rootPath, each),
    );
    if (entry) return fetchEntries(sources, entry);
    return {
      text: sources
        .map(
          (source) =>
            `## ${source.label}\n\n${source.content.trim() || "(empty)"}`,
        )
        .join("\n\n"),
    };
  }

  private executeRemember(
    params: Record<string, unknown>,
    ctx: MemoryContext,
  ): MemoryExecuteResult {
    const parsed = rememberParamsSchema.safeParse(params);
    if (!parsed.success) return invalidParams("remember", parsed.error);
    const { title, text, tags, scope = "session", replaces } = parsed.data;
    const result = this.write(
      ctx.rootPath,
      scope,
      titledEntry(title, text, tags),
      replaces,
    );
    return {
      text:
        `Stored to ${result.scope} memory. The user has been shown a ` +
        `confirmation of exactly what was saved.`,
      effects: [
        { kind: "remembered", scope: result.scope, text: result.added },
      ],
    };
  }

  private executeSuggest(
    params: Record<string, unknown>,
    ctx: MemoryContext,
  ): MemoryExecuteResult {
    const parsed = suggestParamsSchema.safeParse(params);
    if (!parsed.success) return invalidParams("suggest_memory", parsed.error);
    const { title, text, scope = "global" } = parsed.data;
    const suggestion = this.addSuggestion(
      ctx.sessionId,
      scope,
      titledEntry(title, text),
    );
    return {
      text:
        "Suggestion shown to the user. Awaiting their confirmation before " +
        "anything is stored; do not assume it was remembered.",
      effects: [
        {
          kind: "suggested",
          scope,
          suggestionId: suggestion.id,
          text: suggestion.text,
        },
      ],
    };
  }

  /** Writes session memory, creating the file (with a header) on first write. */
  writeSession(
    rootPath: string,
    text: string,
    replaces?: string,
  ): MemoryWriteResult {
    const current = this.readSession(rootPath) || header("Session memory");
    const stored = applyEdit(current, text, replaces);
    writeFileSync(this.sessionFile(rootPath), stored);
    return { scope: "session", stored, added: text.trim() };
  }

  /**
   * Writes global memory and refreshes the session's snapshot so the agent's
   * own reads stay consistent within the live process.
   */
  writeGlobal(
    rootPath: string,
    text: string,
    replaces?: string,
  ): MemoryWriteResult {
    this.ensureGlobalFile();
    const current = this.readGlobal() || header("Global memory");
    const stored = applyEdit(current, text, replaces);
    writeFileSync(this.globalFile(), stored);
    try {
      writeFileSync(this.sessionGlobalSnapshot(rootPath), stored);
    } catch {
      // Snapshot refresh is best-effort; the canonical write already succeeded.
    }
    return { scope: "global", stored, added: text.trim() };
  }

  /**
   * Overwrites the entire global memory file with `content`. Unlike
   * {@link writeGlobal} (which appends/replaces a fragment), this is a full
   * replace used by the editor UI. Per-session snapshots refresh on the next
   * session spawn via {@link initSession}.
   */
  replaceGlobal(content: string): string {
    this.ensureGlobalFile();
    const stored = content.endsWith("\n") ? content : `${content}\n`;
    writeFileSync(this.globalFile(), stored);
    return stored;
  }

  /** Dispatches a write to the matching store. */
  write(
    rootPath: string,
    scope: MemoryScope,
    text: string,
    replaces?: string,
  ): MemoryWriteResult {
    return scope === "global"
      ? this.writeGlobal(rootPath, text, replaces)
      : this.writeSession(rootPath, text, replaces);
  }

  /**
   * Empties a store back to its header, so removing a memory resource leaves the
   * store the agent reads consistent with the catalog. Global also refreshes the
   * session snapshot.
   */
  clear(rootPath: string, scope: MemoryScope): void {
    if (scope === "global") {
      this.ensureGlobalFile();
      writeFileSync(this.globalFile(), header("Global memory"));
      try {
        writeFileSync(
          this.sessionGlobalSnapshot(rootPath),
          header("Global memory"),
        );
      } catch {
        // Snapshot refresh is best-effort; the canonical write already succeeded.
      }
      return;
    }
    writeFileSync(this.sessionFile(rootPath), header("Session memory"));
  }

  /** Records an agent-initiated suggestion and returns its id. */
  addSuggestion(
    sessionId: string,
    scope: MemoryScope,
    text: string,
  ): PendingSuggestion {
    const suggestion: PendingSuggestion = {
      id: randomUUID(),
      sessionId,
      scope,
      text: text.trim(),
    };
    this.suggestions.set(suggestion.id, suggestion);
    return suggestion;
  }

  /** Removes and returns a pending suggestion, if it exists. */
  takeSuggestion(id: string): PendingSuggestion | undefined {
    const suggestion = this.suggestions.get(id);
    if (suggestion) this.suggestions.delete(id);
    return suggestion;
  }
}
