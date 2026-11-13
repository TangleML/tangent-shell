import type { MarketplaceListing } from "@tangent/shared/contracts.ts";

export type { MarketplaceListing };

/** Per-install context passed to a {@link ExtensionMarketplace.install}. */
export interface InstallContext {
  /**
   * For `file` sources: the absolute path to the preserved upload (under the
   * install's `source/`). Omitted for sources that fetch their own bytes
   * (npm/git).
   */
  sourcePath?: string;
}

/**
 * A pluggable install source for global extensions. The registry keys one by
 * its {@link ExtensionMarketplace.id} (`npm`, `git`, `file`, or a future
 * proprietary source), and a `"<id>:<ref>"` source string selects it. Adding a
 * new source is one class plus one `register()` call — nothing else in the
 * install/spawn path changes.
 */
export interface ExtensionMarketplace {
  /** Stable source id used as the `"<id>:<ref>"` prefix. */
  readonly id: string;
  /**
   * Installs `ref` into `pkgDir` (an empty, install-owned directory) and returns
   * the absolute package root — the directory holding the package's
   * `package.json`, or the directory a single-file extension was copied into.
   */
  install(ref: string, pkgDir: string, ctx: InstallContext): Promise<string>;
  /** Optional discovery, when the source exposes a searchable catalog. */
  search?(query: string): Promise<MarketplaceListing[]>;
}

/** A parsed `"<marketplace>:<ref>"` source: the resolved marketplace and ref. */
export interface ParsedSource {
  marketplace: ExtensionMarketplace;
  ref: string;
}

/**
 * The resource paths and tool allowlist a set of installed extensions
 * contributes to a Pi spawn. Mirrors the shape {@link
 * import("../memory/resolver.ts").MemorySpawnPlan} contributes, so the agent
 * manager folds both in the same way.
 */
export interface ExtensionSpawnPlan {
  /** Absolute `--extension` file paths. */
  extensionPaths: string[];
  /** Absolute `--skill` directory (or file) paths. */
  skillPaths: string[];
  /** Absolute `--prompt-template` file paths. */
  promptPaths: string[];
  /** Tool names unioned into the agent's `--tools` allowlist. */
  allowlistTools: string[];
}
