import type { MemoryScope } from "@tangent/shared/contracts.ts";

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

/** One parameter of a dispatcher-backed memory tool, serializable to the Pi
 * extension so it can rebuild the typebox schema without the server shipping
 * typebox types across the process boundary. */
export interface MemoryToolParam {
  name: string;
  type: "string" | "enum";
  description: string;
  optional?: boolean;
  /** Allowed values when {@link MemoryToolParam.type} is `"enum"`. */
  values?: readonly string[];
}

/**
 * A dispatcher-backed memory tool: one the Pi memory extension registers and
 * whose `execute` calls back into `/internal/memory/call`. pi-memory tools are
 * NOT dispatcher-backed — that extension owns their execute — so a PiMemory
 * backend returns none of these.
 */
export interface MemoryToolSpec {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  params: MemoryToolParam[];
}

/**
 * A server-side side-effect a backend asks the `/call` route to perform after
 * handling a tool call: the chat highlight for an applied write, or the
 * confirm/dismiss card for a proposed one. Kept out of the backend so the file
 * logic stays pure and the socket/chat wiring lives in the route.
 */
export type MemoryEffect =
  | { kind: "remembered"; scope: MemoryScope; text: string }
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
  /** Standing context appended to every agent's system prompt; keep it small. */
  preamble(ctx: MemoryContext): string;
  /** Dispatcher-backed tools this backend exposes to `role`. */
  tools(role: AgentRole): MemoryToolSpec[];
  /** Spawn-time extras (env / extensions / allowlist) for `role`. */
  spawn?(ctx: MemoryContext, role: AgentRole): MemorySpawnExtras;
  /**
   * Handles a dispatcher tool call, or returns `undefined` when `name` is not
   * one of this backend's tools (so a composite can try the next child).
   */
  execute(
    name: string,
    params: Record<string, unknown>,
    ctx: MemoryContext,
  ): MemoryExecuteResult | undefined;
}
