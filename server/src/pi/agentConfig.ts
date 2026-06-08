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

/** Tools every agent gets: read the shared room transcript and its memory. */
export const SHARED_AGENT_TOOLS = ["read_room", "read_memory"] as const;

/**
 * Memory-mutation tools (registered by the memory extension) that only Prime
 * may use, since Prime owns the human conversation. Like the orchestration
 * tools, these must be in Prime's allowlist or Pi would filter them out.
 */
export const PRIME_MEMORY_TOOLS = ["remember", "suggest_memory"] as const;

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

/** Sub-agent defaults sourced from a bundle's `subagents` manifest block. */
export interface SubagentDefaults {
  /** Default tool allowlist for sub-agents lacking an explicit list. */
  tools?: readonly string[];
  /** Default appended system prompt for sub-agents. */
  appendSystemPrompt?: string;
}

/**
 * A session's fully resolved configuration, produced by installing a
 * Configuration Bundle (see `config/bundleLoader.ts`). Drives the Pi spawn for
 * every agent in the session: Prime's prompt/tools, sub-agent defaults and
 * templates, plus the absolute skill/workflow/extension paths passed as flags.
 */
export interface ResolvedSessionConfig {
  /** Prime agent's tools + appended system prompt. */
  prime: AgentConfig;
  /** Defaults applied to sub-agents spawned in this session. */
  subagentDefaults: SubagentDefaults;
  /** Sub-agent templates loaded from the bundle's `agents/`. */
  templates: Map<string, AgentTemplate>;
  /** Absolute paths passed via `--skill` (skill dirs containing SKILL.md). */
  skillPaths: string[];
  /** Absolute paths passed via `--prompt-template` (workflow files). */
  workflowPaths: string[];
  /** Absolute paths passed via extra `--extension` flags (custom tools). */
  extensionPaths: string[];
  /** Pre-seeded Prime first-message content, if the bundle declares one. */
  welcomeMessage?: string;
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

/** Lists `*.md` template files in `dir`, or `[]` if the directory is missing. */
function readTemplateDir(dir: string): string[] {
  try {
    return readdirSync(dir).filter((entry) => entry.endsWith(".md"));
  } catch {
    return [];
  }
}

/** Parses one `agents/<name>.md` file into a template, or `null` if unnamed. */
function parseTemplateFile(dir: string, entry: string): AgentTemplate | null {
  const { frontmatter, body } = parseFrontmatter(
    readFileSync(path.join(dir, entry), "utf8"),
  );
  const name = frontmatter.name?.trim();
  if (!name) return null;
  return {
    name,
    description: frontmatter.description?.trim() ?? "",
    tools: parseToolList(frontmatter.tools),
    systemPrompt: body,
  };
}

/** Parses every `agents/<name>.md` template found in `dir` into a map. */
export function buildTemplatesFromDir(dir: string): Map<string, AgentTemplate> {
  const templates = new Map<string, AgentTemplate>();
  for (const entry of readTemplateDir(dir)) {
    const template = parseTemplateFile(dir, entry);
    if (template) templates.set(template.name, template);
  }
  return templates;
}

/**
 * Loads sub-agent templates from `agents/*.md`. Each file carries
 * `name`/`description`/`tools` frontmatter and a markdown body used as the
 * system prompt.
 *
 * With no `dir`, loads the server's bundled global templates (cached; editing
 * them takes effect on the next server start). With a `dir` (e.g. a session's
 * `.tangent/agents`), loads fresh so per-session bundles aren't cached globally.
 */
export function loadAgentTemplates(dir?: string): Map<string, AgentTemplate> {
  if (dir) return buildTemplatesFromDir(dir);

  if (cachedTemplates) return cachedTemplates;
  cachedTemplates = buildTemplatesFromDir(
    path.join(import.meta.dirname, "agents"),
  );
  return cachedTemplates;
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
        ...PRIME_MEMORY_TOOLS,
      ],
      appendSystemPrompt: loadPrimeSystemPrompt(),
    };
  }
  return cachedPrimeConfig;
}

/**
 * Options that make sub-agent resolution session-aware. When a session was
 * created from a Configuration Bundle, its templates and sub-agent defaults
 * override the server's global fallbacks.
 */
export interface ResolveSubagentOptions {
  /** Session's sub-agent templates (from the bundle's `agents/`). */
  templates?: Map<string, AgentTemplate>;
  /** Session's sub-agent defaults (from the bundle's `subagents` block). */
  defaults?: SubagentDefaults;
}

/**
 * Resolves the tool allowlist: inline request wins, then the template's, then
 * the session/bundle default, then the global default set. `read_room` is
 * always granted (deduped) so sub-agents can read the shared room, since the
 * allowlist would otherwise strip the extension's `read_room` tool.
 */
function pickTools(
  request: SubagentSpawnRequest,
  template: AgentTemplate | undefined,
  defaults: SubagentDefaults | undefined,
): string[] {
  const requested =
    request.tools ?? template?.tools ?? defaults?.tools ?? DEFAULT_TOOLS;
  return [...new Set([...requested, ...SHARED_AGENT_TOOLS])];
}

/**
 * Resolves the system prompt: inline request, then template, then the
 * session/bundle default, then the global base prompt.
 */
function pickPrompt(
  request: SubagentSpawnRequest,
  template: AgentTemplate | undefined,
  defaults: SubagentDefaults | undefined,
): string {
  return (
    request.systemPrompt ??
    template?.systemPrompt ??
    defaults?.appendSystemPrompt ??
    loadDefaultSystemPrompt()
  );
}

/**
 * Resolves a sub-agent's effective config from a spawn request: a template
 * supplies defaults for tools and system prompt, and inline fields override
 * them. When `options` carries a session's bundle templates/defaults those are
 * used; otherwise it falls back to the global templates and base session prompt.
 */
export function resolveSubagentConfig(
  request: SubagentSpawnRequest,
  options: ResolveSubagentOptions = {},
): AgentConfig {
  const templates = options.templates ?? loadAgentTemplates();
  const template = request.template
    ? templates.get(request.template)
    : undefined;

  return {
    tools: pickTools(request, template, options.defaults),
    appendSystemPrompt: pickPrompt(request, template, options.defaults),
  };
}
