import path from "node:path";

import type { MemoryBinding } from "@tangent/shared/contracts.ts";

import type { SessionStore } from "../store/sessionStore.ts";
import {
  checkPiMemoryStore,
  countPiMemoryLeaves,
  DEFAULT_PI_MEMORY_DIR,
  type PiMemoryBinding,
  resolveRoot,
  storeAvailable,
} from "./binding.ts";
import { CompositeMemory } from "./composite.ts";
import { DroppedMemoryNotice } from "./droppedNotice.ts";
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

/** Looks up the backing directories of the shared folders a session mounted. */
export type MountedFolders = (sessionId: string) => Promise<string[]>;

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

/** Everything the manager needs to fold a session's memory into a Pi spawn. */
export interface MemorySpawnPlan {
  /** Extra env (e.g. `PI_MEMORY_DIR`), merged into the reserved spawn env. */
  env: Record<string, string>;
  /** Extra `--extension` paths (e.g. the pi-memory package entry). */
  extensionPaths: string[];
  /** `--tools` allowlist entries the resolved memory contributes for `role`. */
  allowlistTools: string[];
  /** Memory tools Prime gets but `role` must not, removed from any allowlist a
   * spawn request or template asks for. */
  deniedTools: string[];
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

  /** The standing-context memory preamble appended to a `role` agent's prompt. */
  preamble(role: AgentRole): string {
    return this.root.preamble(this.ctx, role);
  }

  private extras(role: AgentRole): Required<MemorySpawnExtras> {
    return normalizeExtras(this.root.spawn?.(this.ctx, role) ?? {});
  }

  /** The `--tools` entries this memory grants `role`. */
  private grantedTools(
    role: AgentRole,
    extras: Required<MemorySpawnExtras>,
  ): string[] {
    return [
      ...new Set([
        ...this.root.tools(role).map((spec) => spec.name),
        ...extras.allowlistTools,
      ]),
    ];
  }

  /** The env / extensions / allowlist this memory contributes to a `role` spawn. */
  spawnPlan(role: AgentRole): MemorySpawnPlan {
    const extras = this.extras(role);
    const allowlistTools = this.grantedTools(role, extras);
    const granted = new Set(allowlistTools);
    const deniedTools =
      role === "prime"
        ? []
        : this.grantedTools("prime", this.extras("prime")).filter(
            (name) => !granted.has(name),
          );
    return {
      env: extras.env,
      extensionPaths: extras.extensionPaths,
      allowlistTools,
      deniedTools,
    };
  }

  /** Runs a dispatcher tool called by a `role` agent against this memory. */
  execute(
    name: string,
    params: Record<string, unknown>,
    role: AgentRole,
  ): MemoryExecuteResult | undefined {
    return this.root.execute(name, params, this.ctx, role);
  }
}

/** Receives the root of each binding leaf left out at spawn. */
type OnDrop = (label: string) => void;

type SimpleMdBinding = Extract<MemoryBinding, { kind: "simple-md" }>;

/** The root a dropped leaf is reported under to agents. */
function leafLabel(binding: MemoryBinding): string {
  if (binding.kind === "composite") return "memory binding";
  if (binding.kind === "pi-memory") {
    return binding.root ?? DEFAULT_PI_MEMORY_DIR;
  }
  return binding.root ?? "session memory";
}

/**
 * Builds a `pi-memory` leaf, or `undefined` when its store has become
 * unavailable since the session was created (e.g. a deleted shared folder).
 */
function buildPiMemory(
  binding: PiMemoryBinding,
  base: string,
  mountedFolders: readonly string[],
  onDrop: OnDrop,
): MemoryBackend | undefined {
  const store = checkPiMemoryStore(binding, base, mountedFolders);
  if ("reason" in store) {
    console.warn(`[memory] leaving pi-memory out: ${store.reason}`);
    onDrop(leafLabel(binding));
    return undefined;
  }
  return new PiMemory(store.dir, binding.config, store.label);
}

/**
 * Builds a rooted `simple-md` leaf, or `undefined` for a rootless one (already
 * covered by the always-on SimpleMD store) or one whose folder isn't there —
 * pointing Prime at it would create a directory at a mount name.
 */
function buildSharedMarkdown(
  binding: SimpleMdBinding,
  base: string,
  mountedFolders: readonly string[],
  onDrop: OnDrop,
): MemoryBackend | undefined {
  if (!binding.root) return undefined;
  if (!storeAvailable(base, binding.root)) {
    console.warn(
      `[memory] leaving the simple-md note out: root "${binding.root}" is not an existing folder`,
    );
    onDrop(binding.root);
    return undefined;
  }
  return new SharedMarkdownMemory(
    resolveRoot(base, binding.root, mountedFolders),
    binding.root,
  );
}

/**
 * Builds a {@link MemoryBackend} from a session's {@link MemoryBinding},
 * resolving each directory-backed leaf's `root` relative to the absolute session
 * root `base`. A `root` pointing into a mounted shared folder shares the store;
 * omitting it keeps the store session-local. Returns `undefined` when the
 * binding adds no backend (an empty composite, a rootless `simple-md` leaf, or
 * an unavailable store); each unavailable leaf is reported to `onDrop`.
 */
function buildSessionBackend(
  binding: MemoryBinding,
  base: string,
  mountedFolders: readonly string[],
  onDrop: OnDrop,
): MemoryBackend | undefined {
  if (binding.kind === "simple-md") {
    return buildSharedMarkdown(binding, base, mountedFolders, onDrop);
  }
  if (binding.kind === "pi-memory") {
    return buildPiMemory(binding, base, mountedFolders, onDrop);
  }
  const children = binding.children
    .map((child) => buildLeafSafely(child, base, mountedFolders, onDrop))
    .filter((child): child is MemoryBackend => child !== undefined);
  if (children.length === 0) return undefined;
  if (children.length === 1) return children[0];
  return new CompositeMemory(children);
}

/** {@link buildSessionBackend} for one composite child, so an invalid child is
 * dropped without taking its siblings with it. */
function buildLeafSafely(
  binding: MemoryBinding,
  base: string,
  mountedFolders: readonly string[],
  onDrop: OnDrop,
): MemoryBackend | undefined {
  try {
    return buildSessionBackend(binding, base, mountedFolders, onDrop);
  } catch (err) {
    console.warn(`[memory] ignoring invalid memory binding leaf:`, err);
    onDrop(leafLabel(binding));
    return undefined;
  }
}

/**
 * Builds a session's {@link ResolvedMemory} from the always-on SimpleMD store
 * (session + global) plus, when the session carries a memory binding, that
 * binding's resolved backend — whose store directory may point into a mounted
 * shared folder to share it across sessions. {@link resolve} reads the session
 * binding; {@link resolveDefault} is the SimpleMD-only fallback.
 */
export class MemoryResolver {
  private readonly simpleMd: SimpleMdMemory;
  private readonly sessions?: SessionStore;
  private readonly mountedFolders?: MountedFolders;

  /**
   * @param mountedFolders the backing directories of the shared folders a
   * session has mounted; a binding may only resolve into these (or the session
   * root). Without it no shared folder is reachable.
   */
  constructor(
    simpleMd: SimpleMdMemory,
    sessions?: SessionStore,
    mountedFolders?: MountedFolders,
  ) {
    this.simpleMd = simpleMd;
    this.sessions = sessions;
    this.mountedFolders = mountedFolders;
  }

  /** SimpleMD-only resolution (session + global); no async store lookups. */
  resolveDefault(sessionId: string, rootPath: string): ResolvedMemory {
    return new ResolvedMemory(this.simpleMd, { sessionId, rootPath });
  }

  /**
   * Full resolution: SimpleMD plus the session's own memory binding, if any,
   * and a {@link DroppedMemoryNotice} for any leaf whose store is unavailable.
   * Falls back to {@link resolveDefault} when no store is wired, the session has
   * no binding, or the binding adds nothing and drops nothing.
   */
  async resolve(sessionId: string, rootPath: string): Promise<ResolvedMemory> {
    const binding = await this.sessions?.getSessionMemory(sessionId);
    if (!binding) return this.resolveDefault(sessionId, rootPath);

    const mounts = (await this.mountedFolders?.(sessionId)) ?? [];
    return this.resolveBinding(binding, { sessionId, rootPath }, mounts);
  }

  /** SimpleMD composed with what the binding builds and a notice for what it drops. */
  private resolveBinding(
    binding: MemoryBinding,
    ctx: MemoryContext,
    mountedFolders: readonly string[],
  ): ResolvedMemory {
    const dropped: string[] = [];
    const backend = this.safeBuild(binding, ctx, mountedFolders, (label) => {
      dropped.push(label);
    });
    const children: MemoryBackend[] = [
      this.simpleMd,
      ...(backend ? [backend] : []),
      ...(dropped.length > 0 ? [new DroppedMemoryNotice(dropped)] : []),
    ];
    if (children.length === 1) return new ResolvedMemory(this.simpleMd, ctx);
    return new ResolvedMemory(new CompositeMemory(children), ctx);
  }

  /**
   * Builds the session binding's backend, or `undefined` on more than one
   * pi-memory leaf (a stored binding that predates the schema's limit) or when
   * no leaf survives a bad `root`, a missing folder, or a missing pi-memory
   * package; a composite drops only its failing children. Every leaf left out
   * is reported to `onDrop`.
   */
  private safeBuild(
    binding: MemoryBinding,
    ctx: MemoryContext,
    mountedFolders: readonly string[],
    onDrop: OnDrop,
  ): MemoryBackend | undefined {
    if (countPiMemoryLeaves(binding) > 1) {
      console.warn(
        `[memory] ignoring memory binding with more than one pi-memory store`,
      );
      onDrop(leafLabel(binding));
      return undefined;
    }
    return buildLeafSafely(
      binding,
      path.resolve(ctx.rootPath),
      mountedFolders,
      onDrop,
    );
  }
}
