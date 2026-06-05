import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Curated allowlist of Pi tools every session gets by default. Because each
 * session's Pi process runs with its `cwd` set to the session's scoped folder,
 * these tools operate strictly within that directory. Kept intentionally small
 * so the agent can read, edit, and run things in its workspace without broader
 * capabilities.
 */
export const DEFAULT_TOOLS = [
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "find",
  "ls",
] as const;

/**
 * Per-session agent configuration. In Phase 3 every session uses the default
 * config, but this shape is the seam for per-session tool sets and prompts.
 */
export interface AgentConfig {
  /** Comma-joined into Pi's `--tools` allowlist. */
  tools: readonly string[];
  /** Appended to Pi's built-in prompt via `--append-system-prompt`. */
  appendSystemPrompt: string;
}

/** Reads the editable default system prompt colocated with this module. */
export function loadDefaultSystemPrompt(): string {
  return readFileSync(
    path.join(import.meta.dirname, "systemPrompt.md"),
    "utf8",
  );
}

let cachedDefaultConfig: AgentConfig | null = null;

/**
 * Returns the default agent config, loading the system prompt MD once and
 * caching it. Editing `systemPrompt.md` takes effect on the next server start.
 */
export function getDefaultAgentConfig(): AgentConfig {
  if (!cachedDefaultConfig) {
    cachedDefaultConfig = {
      tools: DEFAULT_TOOLS,
      appendSystemPrompt: loadDefaultSystemPrompt(),
    };
  }
  return cachedDefaultConfig;
}
