import { readdirSync, readFileSync } from "node:fs";
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
 * Orchestration tools (registered by the orchestrator extension) that only
 * Prime may use. Pi's `--tools` allowlist filters extension/custom tools too,
 * so these names must be present in Prime's allowlist or they'd be disabled.
 */
export const PRIME_ORCHESTRATION_TOOLS = [
  "spawn_subagent",
  "message_subagent",
  "kill_subagent",
  "list_subagents",
] as const;

/** Tool every agent gets so it can read the shared room transcript. */
export const SHARED_AGENT_TOOLS = ["read_room"] as const;

/**
 * Per-agent configuration. Drives the tool allowlist and appended system prompt
 * passed to a Pi process, whether it is the session's Prime agent or one of the
 * sub-agents Prime spawns.
 */
export interface AgentConfig {
  /** Comma-joined into Pi's `--tools` allowlist. */
  tools: readonly string[];
  /** Appended to Pi's built-in prompt via `--append-system-prompt`. */
  appendSystemPrompt: string;
}

/** A reusable sub-agent definition loaded from `agents/<name>.md`. */
export interface AgentTemplate {
  name: string;
  description: string;
  tools?: readonly string[];
  systemPrompt: string;
}

/** Request Prime makes to spawn a sub-agent. Inline fields override templates. */
export interface SubagentSpawnRequest {
  /** Display name for the sub-agent (its author name in the room). */
  name: string;
  /** Optional template to seed tools and system prompt from. */
  template?: string;
  /** Inline system prompt; overrides the template's prompt. */
  systemPrompt?: string;
  /** Inline tool allowlist; overrides the template's tools. */
  tools?: string[];
  /** Optional initial task to deliver to the sub-agent right after spawn. */
  task?: string;
}

function readPrompt(file: string): string {
  return readFileSync(path.join(import.meta.dirname, file), "utf8");
}

/** Reads the base session system prompt (also the sub-agent default). */
export function loadDefaultSystemPrompt(): string {
  return readPrompt("systemPrompt.md");
}

/** Reads the Prime orchestration system prompt. */
export function loadPrimeSystemPrompt(): string {
  return readPrompt("primePrompt.md");
}

/**
 * Minimal `key: value` YAML frontmatter parser for agent template files. Only
 * supports the flat scalar fields the templates use (`name`, `description`,
 * `tools`, ...); anything richer would warrant a real YAML dependency.
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (key) frontmatter[key] = value;
  }
  return { frontmatter, body: match[2].trim() };
}

function parseToolList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const tools = raw
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
  return tools.length > 0 ? tools : undefined;
}

let cachedTemplates: Map<string, AgentTemplate> | null = null;

/**
 * Loads sub-agent templates from `agents/*.md`, caching the result. Each file
 * carries `name`/`description`/`tools` frontmatter and a markdown body used as
 * the system prompt. Editing templates takes effect on the next server start.
 */
export function loadAgentTemplates(): Map<string, AgentTemplate> {
  if (cachedTemplates) return cachedTemplates;

  const templates = new Map<string, AgentTemplate>();
  const dir = path.join(import.meta.dirname, "agents");

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    cachedTemplates = templates;
    return templates;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const { frontmatter, body } = parseFrontmatter(
      readFileSync(path.join(dir, entry), "utf8"),
    );
    const name = frontmatter.name?.trim();
    if (!name) continue;
    templates.set(name, {
      name,
      description: frontmatter.description?.trim() ?? "",
      tools: parseToolList(frontmatter.tools),
      systemPrompt: body,
    });
  }

  cachedTemplates = templates;
  return templates;
}

/** Returns the available sub-agent templates (for Prime's tool description). */
export function listAgentTemplates(): AgentTemplate[] {
  return [...loadAgentTemplates().values()];
}

let cachedPrimeConfig: AgentConfig | null = null;

/**
 * Returns the Prime agent config: the default tools plus the orchestration
 * system prompt that documents how to spawn and direct sub-agents.
 */
export function getPrimeAgentConfig(): AgentConfig {
  if (!cachedPrimeConfig) {
    cachedPrimeConfig = {
      tools: [
        ...DEFAULT_TOOLS,
        ...SHARED_AGENT_TOOLS,
        ...PRIME_ORCHESTRATION_TOOLS,
      ],
      appendSystemPrompt: loadPrimeSystemPrompt(),
    };
  }
  return cachedPrimeConfig;
}

/**
 * Resolves a sub-agent's effective config from a spawn request: a template
 * supplies defaults for tools and system prompt, and inline fields override
 * them. Falls back to the default tools and base session prompt.
 */
export function resolveSubagentConfig(
  request: SubagentSpawnRequest,
): AgentConfig {
  const template = request.template
    ? loadAgentTemplates().get(request.template)
    : undefined;

  const requested = request.tools ?? template?.tools ?? DEFAULT_TOOLS;
  // Always grant read_room (deduped) so sub-agents can read the shared room,
  // since the allowlist would otherwise strip the extension's read_room tool.
  const tools = [...new Set([...requested, ...SHARED_AGENT_TOOLS])];
  const appendSystemPrompt =
    request.systemPrompt ?? template?.systemPrompt ?? loadDefaultSystemPrompt();

  return { tools, appendSystemPrompt };
}
