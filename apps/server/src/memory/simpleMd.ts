import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { MemoryScope } from "@tangent/shared/contracts.ts";

import {
  GLOBAL_MEMORY_DIR,
  GLOBAL_MEMORY_FILENAME,
  SESSION_MEMORY_FILENAME,
} from "../config.ts";
import type {
  AgentRole,
  MemoryBackend,
  MemoryContext,
  MemoryExecuteResult,
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

/** The dispatcher tools SimpleMD exposes, by role. Descriptions live here (not
 * in the Pi extension) so tool behavior and copy stay with the backend. */
const READ_MEMORY_TOOL: MemoryToolSpec = {
  name: "read_memory",
  label: "Read Memory",
  description:
    "Read your current memory: the global store (applies to every session) " +
    "and the session store (this session only). Use this to ground yourself " +
    "before acting and to verify what is actually stored before claiming to " +
    "remember something.",
  promptSnippet: "Read your global + session memory",
  params: [],
};

const REMEMBER_TOOL: MemoryToolSpec = {
  name: "remember",
  label: "Remember",
  description:
    "Store a fact in memory. Use scope 'session' (default) when the user " +
    "says to remember/memorize something for this session, or when you spot " +
    "an obvious, durable improvement to how you should work here. Use scope " +
    "'global' ONLY when the user has EXPLICITLY asked you to remember it " +
    "across all sessions — otherwise use suggest_memory instead. To revise " +
    "an existing fact, pass the exact prior text in `replaces`. After it " +
    "succeeds, tell the user plainly what you stored.",
  promptSnippet:
    "Store a fact in session (or, on explicit request, global) memory",
  params: [
    {
      name: "text",
      type: "string",
      description: "The fact to store, as a concise markdown line or block.",
    },
    {
      name: "scope",
      type: "enum",
      values: ["session", "global"],
      optional: true,
      description: "'session' (default) or 'global' (explicit request only).",
    },
    {
      name: "replaces",
      type: "string",
      optional: true,
      description: "Exact existing text to replace, when revising a fact.",
    },
  ],
};

const SUGGEST_MEMORY_TOOL: MemoryToolSpec = {
  name: "suggest_memory",
  label: "Suggest Memory",
  description:
    "Propose remembering something WITHOUT writing it yet. Use this for " +
    "anything you think is worth remembering globally but the user did not " +
    "explicitly ask to store. The user is shown a confirm/dismiss card; only " +
    "if they confirm is it written. Do not claim it was remembered until you " +
    "are told the user confirmed.",
  promptSnippet: "Propose a memory the user must confirm before it is stored",
  params: [
    {
      name: "text",
      type: "string",
      description: "The fact you propose to remember.",
    },
    {
      name: "scope",
      type: "enum",
      values: ["session", "global"],
      optional: true,
      description: "Which store to propose writing to (default 'global').",
    },
  ],
};

/** Narrows an unknown scope param to a {@link MemoryScope}, with a default. */
function coerceScope(value: unknown, fallback: MemoryScope): MemoryScope {
  return value === "global" || value === "session" ? value : fallback;
}

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

  /**
   * Builds the per-session "## Memory" preamble appended to every agent's
   * system prompt, embedding the current global and session memory so memory is
   * available from the first turn of every session.
   */
  buildPreamble(rootPath: string): string {
    const global = this.readGlobal().trim();
    const session = this.readSession(rootPath).trim();

    const lines = [
      "## Memory",
      "",
      "You have two memory stores. Treat them as authoritative standing context",
      "and consult them before acting. Modify them only via the memory tools",
      "(`remember`, `suggest_memory`); never claim to have stored something you",
      "did not actually write.",
      "",
      "### Global memory (applies to every session)",
      "",
      global ? global : "(empty)",
      "",
      "### Session memory (this session only)",
      "",
      session ? session : "(empty — create it with `remember` when useful)",
    ];
    return lines.join("\n");
  }

  /** {@link MemoryBackend.preamble}. */
  preamble(ctx: MemoryContext): string {
    return this.buildPreamble(ctx.rootPath);
  }

  /** {@link MemoryBackend.tools}: read for everyone, writes for Prime only. */
  tools(role: AgentRole): MemoryToolSpec[] {
    if (role === "prime") {
      return [READ_MEMORY_TOOL, REMEMBER_TOOL, SUGGEST_MEMORY_TOOL];
    }
    return [READ_MEMORY_TOOL];
  }

  /** {@link MemoryBackend.execute}: dispatches one SimpleMD dispatcher tool. */
  execute(
    name: string,
    params: Record<string, unknown>,
    ctx: MemoryContext,
  ): MemoryExecuteResult | undefined {
    if (name === "read_memory") return this.executeRead(ctx);
    if (name === "remember") return this.executeRemember(params, ctx);
    if (name === "suggest_memory") return this.executeSuggest(params, ctx);
    return undefined;
  }

  private executeRead(ctx: MemoryContext): MemoryExecuteResult {
    const session = this.readSession(ctx.rootPath).trim() || "(empty)";
    const global = this.readGlobal().trim() || "(empty)";
    return {
      text: `## Global memory\n\n${global}\n\n## Session memory\n\n${session}`,
    };
  }

  private executeRemember(
    params: Record<string, unknown>,
    ctx: MemoryContext,
  ): MemoryExecuteResult {
    const scope = coerceScope(params.scope, "session");
    const text = String(params.text ?? "");
    const replaces =
      typeof params.replaces === "string" ? params.replaces : undefined;
    const result = this.write(ctx.rootPath, scope, text, replaces);
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
    const scope = coerceScope(params.scope, "global");
    const text = String(params.text ?? "");
    const suggestion = this.addSuggestion(ctx.sessionId, scope, text);
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
