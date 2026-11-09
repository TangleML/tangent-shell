import type {
  MemoryHighlightScope,
  MemoryScope,
} from "@tangent/shared/contracts.ts";

export type {
  MemoryBinding,
  PiMemoryConfig,
} from "@tangent/shared/contracts.ts";

/** The two roles a memory backend tailors its tools/allowlist to. */
export type AgentRole = "prime" | "subagent";

/** Per-spawn / per-call context a backend resolves its files and env against. */
export interface MemoryContext {
  sessionId: string;
  rootPath: string;
}

/**
 * A dispatcher-backed memory tool: one the Pi memory extension registers and
 * whose `execute` calls back into `/internal/memory/call`. Only the name is
 * carried (for the `--tools` allowlist); the tool's copy and schema live in the
 * extension. pi-memory tools are NOT dispatcher-backed — that extension owns
 * their execute — so a PiMemory backend returns none of these.
 */
export interface MemoryToolSpec {
  name: string;
}

/**
 * A server-side side-effect a backend asks the `/call` route to perform after
 * handling a tool call: the chat highlight for an applied write, or the
 * confirm/dismiss card for a proposed one. Kept out of the backend so the file
 * logic stays pure and the socket/chat wiring lives in the route.
 */
export type MemoryEffect =
  | { kind: "remembered"; scope: MemoryHighlightScope; text: string }
  | {
      kind: "suggested";
      scope: MemoryScope;
      suggestionId: string;
      text: string;
    };

/** What a backend's {@link MemoryBackend.execute} returns for a handled call. */
export interface MemoryExecuteResult {
  /** Text handed back to the calling agent. */
  text: string;
  /** Side-effects the route performs (highlight, suggestion card). */
  effects?: MemoryEffect[];
  /** The call was rejected (bad params or a role without write access); `text`
   * explains why and no effects apply. */
  error?: boolean;
}

/** Spawn-time extras a backend contributes to the Pi child process. */
export interface MemorySpawnExtras {
  /** Extra env (e.g. `PI_MEMORY_DIR`), merged into the reserved spawn env. */
  env?: Record<string, string>;
  /** Extra `--extension` paths (e.g. the pi-memory package entry). */
  extensionPaths?: string[];
  /** Extra `--tools` allowlist entries beyond the backend's dispatcher tools. */
  allowlistTools?: string[];
}

/** Who a memory source is shared with, as the index tells agents. */
export type MemorySourceScope =
  | "session"
  | "global"
  | "project"
  | "bundle"
  | "unavailable";

/** How an agent reaches a source: through named tools or a workspace file. */
export type MemoryAccess = { tools: string[] } | { file: string };

/** How a source's content was rendered into the preamble. */
export interface MemoryDigestStats {
  entries: number;
  chars: number;
  mode: "empty" | "inline" | "contents";
}

/**
 * One entry of the memory index: what a source holds and how to read or write
 * it. The index is the only place agents are told how to use their memory, so
 * every backend describes itself, tailored to `role`.
 */
export interface MemorySourceInfo {
  title: string;
  scope: MemorySourceScope;
  holds: string;
  read?: MemoryAccess;
  write?: MemoryAccess;
  notes?: string[];
  digest?: MemoryDigestStats;
}

/**
 * A pluggable memory store. Leaves (SimpleMD, pi-memory) implement it directly;
 * {@link import("./composite.ts").CompositeMemory} unions several. The server
 * stays the authority: a backend declares its preamble, its dispatcher tools,
 * its spawn extras, and how to execute a dispatcher tool — the manager and the
 * internal routes drive it.
 */
export interface MemoryBackend {
  readonly kind: string;
  /** Idempotent preparation before the first spawn (e.g. seed files). */
  init(ctx: MemoryContext): void;
  /** The source's content for a `role` agent's system prompt (no usage
   * guidance: that lives in {@link describe}); keep it small. */
  preamble(ctx: MemoryContext, role: AgentRole): string;
  /** The index entries for this backend's sources, tailored to `role`. */
  describe(ctx: MemoryContext, role: AgentRole): MemorySourceInfo[];
  /** Dispatcher-backed tools this backend exposes to `role`. */
  tools(role: AgentRole): MemoryToolSpec[];
  /** Spawn-time extras (env / extensions / allowlist) for `role`. */
  spawn?(ctx: MemoryContext, role: AgentRole): MemorySpawnExtras;
  /**
   * Handles a dispatcher tool call made by a `role` agent, or returns
   * `undefined` when `name` is not one of this backend's tools (so a composite
   * can try the next child).
   */
  execute(
    name: string,
    params: Record<string, unknown>,
    ctx: MemoryContext,
    role: AgentRole,
  ): Promise<MemoryExecuteResult | undefined>;
}
