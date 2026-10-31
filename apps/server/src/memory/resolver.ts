import path from "node:path";

import type { MemoryBinding } from "@tangent/shared/contracts.ts";

import type { SessionStore } from "../store/sessionStore.ts";
import { CompositeMemory } from "./composite.ts";
import { PiMemory } from "./piMemory.ts";
import { SharedMarkdownMemory } from "./sharedMarkdown.ts";
import type { SimpleMdMemory } from "./simpleMd.ts";
import type {
  AgentRole,
  MemoryBackend,
  MemoryContext,
  MemoryExecuteResult,
  MemorySpawnExtras,
} from "./types.ts";

/** Default session-local directory for a `pi-memory` leaf with no `root`. */
const DEFAULT_PI_MEMORY_DIR = ".pi-memory";

/** Fills in a backend's optional spawn extras with empty defaults. */
function normalizeExtras(
  extras: MemorySpawnExtras,
): Required<MemorySpawnExtras> {
  return {
    env: extras.env ?? {},
    extensionPaths: extras.extensionPaths ?? [],
    allowlistTools: extras.allowlistTools ?? [],
  };
}

/**
 * Resolves a binding's session-root-relative `root` into an absolute directory
 * confined to the session root. A `root` pointing at a mounted shared folder
 * (`<mountName>/...`, itself a symlink under the root) shares the store; the
 * guard rejects traversal/absolute paths that would escape the session root.
 */
function resolveRoot(
  rootPath: string,
  relative: string | undefined,
  fallback: string,
): string {
  const rel = relative ?? fallback;
  const resolved = path.resolve(rootPath, rel);
  const within =
    resolved === rootPath || resolved.startsWith(rootPath + path.sep);
  if (!within) {
    throw new Error(
      `[memory] binding root "${rel}" escapes the session root; ignoring`,
    );
  }
  return resolved;
}

/** Everything the manager needs to fold a session's memory into a Pi spawn. */
export interface MemorySpawnPlan {
  /** Extra env (e.g. `PI_MEMORY_DIR`), merged into the reserved spawn env. */
  env: Record<string, string>;
  /** Extra `--extension` paths (e.g. the pi-memory package entry). */
  extensionPaths: string[];
  /** `--tools` allowlist entries the resolved memory contributes for `role`. */
  allowlistTools: string[];
}

/**
 * A session's resolved memory: a root {@link MemoryBackend} bound to one
 * {@link MemoryContext}. Cached on the session's process record so every spawn
 * (first, revive, model-change, respawn) reuses the same resolution. Exposes the
 * spawn-time projections the manager needs and the `execute` the `/call` route
 * dispatches to.
 */
export class ResolvedMemory {
  private readonly root: MemoryBackend;
  private readonly ctx: MemoryContext;

  constructor(root: MemoryBackend, ctx: MemoryContext) {
    this.root = root;
    this.ctx = ctx;
  }

  /** Idempotent store preparation, run once before the first spawn. */
  init(): void {
    this.root.init(this.ctx);
  }

  /** The standing-context memory preamble appended to every agent's prompt. */
  preamble(): string {
    return this.root.preamble(this.ctx);
  }

  /** The env / extensions / allowlist this memory contributes to a `role` spawn. */
  spawnPlan(role: AgentRole): MemorySpawnPlan {
    const extras = normalizeExtras(this.root.spawn?.(this.ctx, role) ?? {});
    const allowlistTools = new Set<string>([
      ...this.root.tools(role).map((spec) => spec.name),
      ...extras.allowlistTools,
    ]);
    return {
      env: extras.env,
      extensionPaths: extras.extensionPaths,
      allowlistTools: [...allowlistTools],
    };
  }

  /** Runs a dispatcher tool against this session's resolved memory. */
  execute(
    name: string,
    params: Record<string, unknown>,
  ): MemoryExecuteResult | undefined {
    return this.root.execute(name, params, this.ctx);
  }
}

/**
 * Builds a {@link MemoryBackend} from a session's {@link MemoryBinding},
 * resolving each directory-backed leaf's `root` relative to the session root.
 * A `root` pointing into a mounted shared folder shares the store; omitting it
 * keeps the store session-local. Returns `undefined` when the binding adds no
 * backend (an empty composite, or a `simple-md` leaf with no `root` — which is
 * already covered by the always-on SimpleMD store).
 */
function buildSessionBackend(
  binding: MemoryBinding,
  rootPath: string,
): MemoryBackend | undefined {
  if (binding.kind === "simple-md") {
    if (!binding.root) return undefined;
    return new SharedMarkdownMemory(
      resolveRoot(rootPath, binding.root, "."),
      binding.root,
    );
  }
  if (binding.kind === "pi-memory") {
    const dir = resolveRoot(rootPath, binding.root, DEFAULT_PI_MEMORY_DIR);
    return new PiMemory(dir, binding.config);
  }
  const children = binding.children
    .map((child) => buildSessionBackend(child, rootPath))
    .filter((child): child is MemoryBackend => child !== undefined);
  if (children.length === 0) return undefined;
  if (children.length === 1) return children[0];
  return new CompositeMemory(children);
}

/**
 * Builds a session's {@link ResolvedMemory} from the always-on SimpleMD store
 * (session + global) plus, when the session carries a memory binding, that
 * binding's resolved backend — whose store directory may point into a mounted
 * shared folder to share it across sessions. {@link resolveDefault} is
 * synchronous (SimpleMD only) for the spawn paths that can't await;
 * {@link resolve} is async for the entry points that read the session binding.
 */
export class MemoryResolver {
  private readonly simpleMd: SimpleMdMemory;
  private readonly sessions?: SessionStore;

  constructor(simpleMd: SimpleMdMemory, sessions?: SessionStore) {
    this.simpleMd = simpleMd;
    this.sessions = sessions;
  }

  /** SimpleMD-only resolution (session + global); no async store lookups. */
  resolveDefault(sessionId: string, rootPath: string): ResolvedMemory {
    return new ResolvedMemory(this.simpleMd, { sessionId, rootPath });
  }

  /**
   * Full resolution: SimpleMD plus the session's own memory binding, if any.
   * Falls back to {@link resolveDefault} when no store is wired, the session has
   * no binding, or the binding adds no backend.
   */
  async resolve(sessionId: string, rootPath: string): Promise<ResolvedMemory> {
    const binding = await this.sessions?.getSessionMemory(sessionId);
    if (!binding) return this.resolveDefault(sessionId, rootPath);

    const backend = this.safeBuild(binding, rootPath);
    if (!backend) return this.resolveDefault(sessionId, rootPath);

    const root = new CompositeMemory([this.simpleMd, backend]);
    return new ResolvedMemory(root, { sessionId, rootPath });
  }

  /** Builds the session backend, degrading to SimpleMD-only on a bad `root`. */
  private safeBuild(
    binding: MemoryBinding,
    rootPath: string,
  ): MemoryBackend | undefined {
    try {
      return buildSessionBackend(binding, rootPath);
    } catch (err) {
      console.warn(`[memory] ignoring invalid memory binding:`, err);
      return undefined;
    }
  }
}
