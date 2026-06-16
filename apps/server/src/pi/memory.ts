import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { MemoryScope } from "@tangent/shared/contracts.ts";

import {
  GLOBAL_MEMORY_DIR,
  GLOBAL_MEMORY_FILENAME,
  SESSION_MEMORY_FILENAME,
} from "../config.ts";

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

/**
 * Owns the agents' memory files: a single global store (from
 * {@link GLOBAL_MEMORY_DIR}) injected into every session, and a per-session
 * file at the session root. The server is the sole writer, so the UI's
 * "remembered" highlight can be derived from the actual file change rather than
 * the agent's narration (keeping the agent honest).
 */
export class MemoryManager {
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
