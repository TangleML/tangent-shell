/**
 * Shared definition of the Tangent Configuration Bundle format.
 *
 * A bundle is a portable `*.zip` that fully provisions a session's Prime and
 * sub-agent prompts, tools, skills, workflows, rules, and memory. This module
 * is the single source of truth for the manifest shape and the conventional
 * directory layout, imported from both `server/` and `src/` via the `@shared/*`
 * path alias so the server validator and the browser builder never drift.
 *
 * Phase 1 defines the format only; runtime wiring (install/spawn) arrives later.
 */

/**
 * Manifest schema version. Bump this integer when a change to {@link
 * BundleManifest} or the layout is backwards-incompatible. A bundle's own
 * `version` field is independent (the author's semver for their preset).
 */
export const SCHEMA_VERSION = 1;

/** Required manifest filename at the root of a bundle. */
export const MANIFEST_FILENAME = "tangent.yaml";

/** Optional preview icon filename at the root of a bundle. */
export const ICON_FILENAME = "icon.svg";

/**
 * Rules file copied to the workspace root so Pi auto-discovers it (alongside
 * CLAUDE.md). Lives under {@link BUNDLE_DIRS.rules} inside the bundle.
 */
export const RULES_FILENAME = "AGENTS.md";

/**
 * Conventional directories inside a bundle. When the matching manifest list
 * (e.g. `skills`) is omitted, these directories are auto-discovered at install
 * time (Phase 3); when present, the manifest is authoritative.
 */
export const BUNDLE_DIRS = {
  /** Appended system prompts: `prompts/prime.md`, `prompts/subagent.md`. */
  prompts: "prompts",
  /** Skills: `skills/<name>/SKILL.md` (passed to Pi via `--skill`). */
  skills: "skills",
  /** Prompt templates: `workflows/<name>.md` (Pi `--prompt-template`). */
  workflows: "workflows",
  /** Sub-agent templates: `agents/<name>.md` (frontmatter + body). */
  agents: "agents",
  /** Holds {@link RULES_FILENAME}, copied to the workspace root. */
  rules: "rules",
  /** Seed memory files (`memory/*.md`) copied into the workspace. */
  memory: "memory",
  /** Optional custom tool extensions (`tools/*.ts`, Pi `--extension`). */
  tools: "tools",
  /** Sandboxed UI component sources (`ui/<name>.tsx`), declared in `ui:`. */
  ui: "ui",
} as const;

/** Prime agent configuration block within the manifest. */
export interface BundlePrimeConfig {
  /** Relative path to the appended system prompt (e.g. `prompts/prime.md`). */
  systemPrompt: string;
  /**
   * Tool allowlist for Prime. Orchestration tools and `read_room` are added
   * automatically at spawn time, so they need not be listed here.
   */
  tools?: string[];
  /**
   * Optional bundle-relative path to a markdown file pre-seeded as Prime's first
   * message at session creation (no LLM call). Lets the agent "speak first".
   */
  welcomeMessage?: string;
}

/**
 * Optional software requirements, keyed by package manager (e.g. `npm`,
 * `pip`, `brew`, `apk`). Each value lists dependency specs of the form
 * `"<package>"` or `"<package>:<version>"`. Declarative only: documents what
 * a session needs installed; Tangent does not install these automatically.
 */
export type BundleSoftwareRequirements = Record<string, string[]>;

/**
 * A sandboxed UI component shipped by a bundle. Source lives under
 * {@link BUNDLE_DIRS.ui} as `.tsx`; the server transpiles it on upload (Phase 3)
 * and the host renders it via remote-dom (Phases 5-6).
 */
export interface BundleUiComponent {
  /**
   * Stable id, unique within the bundle. For `message` components this is the
   * value after `tangent-ui:` in the agent token. Slug `^[a-z0-9][a-z0-9-]*$`.
   */
  name: string;
  /** Which surface renders it: `message` (agent-driven) or `panel` (composer). */
  kind: "message" | "panel";
  /** Bundle-relative path to the component source (conventionally under `ui/`). */
  entry: string;
  /** Display label for `panel` launcher buttons; ignored for `message`. */
  title?: string;
}

/** Defaults applied to sub-agents spawned within a bundle's session. */
export interface BundleSubagentConfig {
  /** Relative path to the default sub-agent system prompt. */
  defaultSystemPrompt?: string;
  /** Default tool allowlist for sub-agents lacking an explicit list. */
  defaultTools?: string[];
}

/**
 * Parsed and validated `tangent.yaml`.
 *
 * The optional list fields (`skills`, `workflows`, `agents`, `contextFiles`,
 * `memory`, `extensions`) are explicit declarations of the relevant entities.
 * When omitted, the corresponding {@link BUNDLE_DIRS} directory is
 * auto-discovered at install time (Phase 3); when present, the manifest list
 * is authoritative.
 */
export interface BundleManifest {
  /** Always {@link SCHEMA_VERSION} for now. */
  schemaVersion: typeof SCHEMA_VERSION;
  /** Stable slug identifying the bundle (`^[a-z0-9][a-z0-9-]*$`). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Author-managed semver for this preset. */
  version: string;
  /** Short description shown in the marketplace. */
  description?: string;
  /** Bundle author. */
  author?: string;
  /** Relative path to a preview icon; defaults to {@link ICON_FILENAME}. */
  icon?: string;
  /** Free-form tags for filtering/search. */
  tags?: string[];
  /** Prime agent configuration. */
  prime: BundlePrimeConfig;
  /** Sub-agent defaults. */
  subagents?: BundleSubagentConfig;
  /** Explicit skill paths (`skills/<name>/SKILL.md`). */
  skills?: string[];
  /** Explicit workflow/prompt-template paths (`workflows/<name>.md`). */
  workflows?: string[];
  /** Explicit sub-agent template paths (`agents/<name>.md`). */
  agents?: string[];
  /** Explicit context files copied to the workspace root. */
  contextFiles?: string[];
  /** Explicit seed memory files (`memory/*.md`). */
  memory?: string[];
  /** Explicit custom tool extension paths (`tools/*.ts`). */
  extensions?: string[];
  /** Optional software requirements keyed by package manager. */
  software?: BundleSoftwareRequirements;
  /** Sandboxed UI components shipped by the bundle. */
  ui?: { components: BundleUiComponent[] };
}
