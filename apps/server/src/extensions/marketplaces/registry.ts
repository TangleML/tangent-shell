import type { ExtensionMarketplace, ParsedSource } from "../types.ts";
import { FileMarketplace } from "./fileMarketplace.ts";
import { GitMarketplace } from "./gitMarketplace.ts";
import { NpmMarketplace } from "./npmMarketplace.ts";

/**
 * Keyed set of {@link ExtensionMarketplace}s. A `"<id>:<ref>"` source string
 * selects one; {@link MarketplaceRegistry.parseSource} splits it. "Marketplace"
 * is intentionally an abstraction: a proprietary source is one new class
 * registered here, with no change to the install or spawn path.
 */
export class MarketplaceRegistry {
  private readonly byId = new Map<string, ExtensionMarketplace>();

  register(marketplace: ExtensionMarketplace): void {
    this.byId.set(marketplace.id, marketplace);
  }

  get(id: string): ExtensionMarketplace | undefined {
    return this.byId.get(id);
  }

  list(): ExtensionMarketplace[] {
    return [...this.byId.values()];
  }

  /**
   * Splits `"<marketplace>:<ref>"` into the resolved marketplace and its ref.
   * Only the first `:` separates them, so a ref may itself contain `:` (e.g. a
   * git url). Throws on an unknown marketplace, a missing separator, or an
   * empty ref.
   */
  parseSource(source: string): ParsedSource {
    const separator = source.indexOf(":");
    if (separator === -1) {
      throw new Error(
        `invalid source "${source}" (expected "<marketplace>:<ref>")`,
      );
    }
    const id = source.slice(0, separator);
    const ref = source.slice(separator + 1).trim();
    const marketplace = this.byId.get(id);
    if (!marketplace) throw new Error(`unknown marketplace "${id}"`);
    if (!ref) throw new Error(`source "${source}" is missing a ref`);
    return { marketplace, ref };
  }
}

/** Builds a registry with the built-in npm, git, and file marketplaces. */
export function createMarketplaceRegistry(): MarketplaceRegistry {
  const registry = new MarketplaceRegistry();
  registry.register(new NpmMarketplace());
  registry.register(new GitMarketplace());
  registry.register(new FileMarketplace());
  return registry;
}
