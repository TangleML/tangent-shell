import type {
  AgentRole,
  MemoryBackend,
  MemoryContext,
  MemoryExecuteResult,
  MemorySpawnExtras,
  MemoryToolSpec,
} from "./types.ts";

/** Accumulator the composite folds each child's spawn extras into. */
interface SpawnAcc {
  env: Record<string, string>;
  extensionPaths: string[];
  allowlistTools: string[];
}

/** Folds one child's (optional) spawn extras into the accumulator. */
function mergeExtras(
  acc: SpawnAcc,
  extras: MemorySpawnExtras | undefined,
): void {
  if (!extras) return;
  Object.assign(acc.env, extras.env ?? {});
  acc.extensionPaths.push(...(extras.extensionPaths ?? []));
  acc.allowlistTools.push(...(extras.allowlistTools ?? []));
}

/**
 * Unions several {@link MemoryBackend} children into one: it inits each child,
 * concatenates their preambles, merges their tools and spawn extras, and routes
 * an `execute` to the first child that recognizes the tool name. A session's
 * resolved memory is a CompositeMemory of the always-on SimpleMD store plus (in
 * a later phase) a mounted shared folder's backend.
 */
export class CompositeMemory implements MemoryBackend {
  readonly kind = "composite";
  private readonly children: readonly MemoryBackend[];

  constructor(children: readonly MemoryBackend[]) {
    this.children = children;
  }

  init(ctx: MemoryContext): void {
    for (const child of this.children) child.init(ctx);
  }

  preamble(ctx: MemoryContext): string {
    return this.children
      .map((child) => child.preamble(ctx).trim())
      .filter(Boolean)
      .join("\n\n");
  }

  tools(role: AgentRole): MemoryToolSpec[] {
    const seen = new Set<string>();
    const specs: MemoryToolSpec[] = [];
    for (const child of this.children) {
      for (const spec of child.tools(role)) {
        if (seen.has(spec.name)) continue;
        seen.add(spec.name);
        specs.push(spec);
      }
    }
    return specs;
  }

  spawn(ctx: MemoryContext, role: AgentRole): MemorySpawnExtras {
    const acc = {
      env: {},
      extensionPaths: [] as string[],
      allowlistTools: [] as string[],
    };
    for (const child of this.children) {
      mergeExtras(acc, child.spawn?.(ctx, role));
    }
    return {
      env: acc.env,
      extensionPaths: [...new Set(acc.extensionPaths)],
      allowlistTools: [...new Set(acc.allowlistTools)],
    };
  }

  execute(
    name: string,
    params: Record<string, unknown>,
    ctx: MemoryContext,
  ): MemoryExecuteResult | undefined {
    for (const child of this.children) {
      const result = child.execute(name, params, ctx);
      if (result) return result;
    }
    return undefined;
  }
}
