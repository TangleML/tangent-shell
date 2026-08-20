import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  type SubagentHost,
  THINKING_LEVELS,
  type ThinkingLevel,
} from "@tangent/shared/contracts.ts";

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

/**
 * Tools every agent gets: read the shared room transcript and its memory, push
 * a directed update to Prime, and pin an artifact to the UI's quick-access list.
 * `message_prime` is only registered by the orchestrator extension for
 * sub-agents (Prime never gets the tool), but it is granted in the allowlist for
 * all agents since Pi's `--tools` filter would otherwise strip the extension's
 * tool from sub-agents. `pin_artifact` is registered by the session extension
 * for every agent, so it must be in the allowlist or Pi would filter it out.
 * `list_remote_tools` / `call_remote_tool` are registered by the remote-tools
 * extension for every agent, so both must be granted or Pi would strip them.
 */
export const SHARED_AGENT_TOOLS = [
  "read_room",
  "read_memory",
  "message_prime",
  "pin_artifact",
  "list_remote_tools",
  "call_remote_tool",
] as const;

/**
 * Trigger tools (registered by the triggers extension) that only Prime may use.
 */
export const PRIME_TRIGGER_TOOLS = [
  "create_trigger",
  "list_triggers",
  "enable_trigger",
  "disable_trigger",
  "delete_trigger",
] as const;

/**
 * Memory-mutation tools (registered by the memory extension) that only Prime
 * may use, since Prime owns the human conversation. Like the orchestration
 * tools, these must be in Prime's allowlist or Pi would filter them out.
 */
export const PRIME_MEMORY_TOOLS = ["remember", "suggest_memory"] as const;

/**
 * Session-management tools (registered by the session extension) that only
 * Prime may use. Like the other extension tools, these must be in Prime's
 * allowlist or Pi would filter them out.
 */
export const PRIME_SESSION_TOOLS = ["rename_session"] as const;

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
  /** `provider/model` id for Pi's `--model`; falls back to the server default. */
  model?: string;
  /** Thinking depth for Pi's `--thinking`; falls back to the server default. */
  thinkingDepth?: ThinkingLevel;
}

/** A reusable sub-agent definition loaded from `agents/<name>.md`. */
export interface AgentTemplate {
  name: string;
  description: string;
  tools?: readonly string[];
  systemPrompt: string;
  /** Default `provider/model` id for sub-agents spawned from this template. */
  model?: string;
  /** Default thinking depth for sub-agents spawned from this template. */
  thinkingDepth?: ThinkingLevel;
}

/** Sub-agent defaults sourced from a bundle's `subagents` manifest block. */
export interface SubagentDefaults {
  /** Default tool allowlist for sub-agents lacking an explicit list. */
  tools?: readonly string[];
  /** Default appended system prompt for sub-agents. */
  appendSystemPrompt?: string;
  /** Default `provider/model` id for sub-agents lacking an explicit one. */
  model?: string;
  /** Default thinking depth for sub-agents lacking an explicit one. */
  thinkingDepth?: ThinkingLevel;
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
  /** Inline `provider/model` id; overrides the template/default model. */
  model?: string;
  /** Inline thinking depth; overrides the template/default thinking depth. */
  thinkingDepth?: ThinkingLevel;
  /**
   * Whether Prime reacts to the sub-agent's finalized replies. Defaults to true;
   * trigger-owned sub-agents pass false to work in isolation, reaching Prime only
   * by addressing it. Persisted, and the value the sub-agent's Memberships are
   * derived from.
   */
  autoRelayToPrime?: boolean;
  /**
   * Which host runs the sub-agent: `local` (a `pi` child) or `remote` (a
   * connected remote environment). Defaults to `local` when omitted.
   */
  environment?: SubagentHost;
}

/** Narrows an arbitrary string to a valid {@link ThinkingLevel}, else undefined. */
export function parseThinkingLevel(
  raw: string | undefined,
): ThinkingLevel | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  return (THINKING_LEVELS as readonly string[]).includes(value)
    ? (value as ThinkingLevel)
    : undefined;
}

function readPrompt(file: string): string {
  return readFileSync(path.join(import.meta.dirname, file), "utf8");
}

/** Reads the base sub-agent system prompt. */
export function loadSubagentSystemPrompt(): string {
  return readPrompt("subagentSystemPrompt.md");
}

/** Reads the Prime orchestration system prompt. */
export function loadPrimeSystemPrompt(): string {
  return readPrompt("primeSystemPrompt.md");
}

/** Joins the always-on base manual with an optional, more-specific prompt. */
function layerPrompt(base: string, specific: string | undefined): string {
  const extra = specific?.trim();
  return extra ? `${base}\n\n${extra}` : base;
}

/**
 * Builds Prime's appended prompt: the always-on Tangent Shell manual
 * (`primeSystemPrompt.md`) followed by an optional bundle-supplied prompt. Blank
 * sessions pass nothing and get the base manual alone.
 */
export function composePrimePrompt(specific?: string): string {
  return layerPrompt(loadPrimeSystemPrompt(), specific);
}

/**
 * Builds a sub-agent's appended prompt: the always-on base manual
 * (`subagentSystemPrompt.md`) followed by an optional template/inline/bundle
 * prompt, so every sub-agent keeps the shared operating instructions.
 */
export function composeSubagentPrompt(specific?: string): string {
  return layerPrompt(loadSubagentSystemPrompt(), specific);
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

/** Trims a frontmatter scalar, returning `undefined` for empty/missing values. */
function optionalTrimmed(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value || undefined;
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
    description: optionalTrimmed(frontmatter.description) ?? "",
    tools: parseToolList(frontmatter.tools),
    systemPrompt: body,
    model: optionalTrimmed(frontmatter.model),
    thinkingDepth: parseThinkingLevel(frontmatter.thinking),
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
        ...PRIME_TRIGGER_TOOLS,
        ...PRIME_SESSION_TOOLS,
      ],
      appendSystemPrompt: composePrimePrompt(),
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
 * Resolves the sub-agent's specific prompt by precedence: inline request, then
 * template, then the session/bundle default. The always-on base manual is
 * layered on by {@link composeSubagentPrompt}, so this returns just the
 * specific layer (or `undefined` to get the base alone).
 */
function pickPrompt(
  request: SubagentSpawnRequest,
  template: AgentTemplate | undefined,
  defaults: SubagentDefaults | undefined,
): string {
  return composeSubagentPrompt(
    request.systemPrompt ??
      template?.systemPrompt ??
      defaults?.appendSystemPrompt,
  );
}

/**
 * Resolves the model id: inline request wins, then the template's, then the
 * session/bundle default. `undefined` falls back to the server default when Pi
 * is spawned.
 */
function pickModel(
  request: SubagentSpawnRequest,
  template: AgentTemplate | undefined,
  defaults: SubagentDefaults | undefined,
): string | undefined {
  return request.model ?? template?.model ?? defaults?.model;
}

/** Resolves the thinking depth with the same precedence as {@link pickModel}. */
function pickThinking(
  request: SubagentSpawnRequest,
  template: AgentTemplate | undefined,
  defaults: SubagentDefaults | undefined,
): ThinkingLevel | undefined {
  return (
    request.thinkingDepth ?? template?.thinkingDepth ?? defaults?.thinkingDepth
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
    model: pickModel(request, template, options.defaults),
    thinkingDepth: pickThinking(request, template, options.defaults),
  };
}
