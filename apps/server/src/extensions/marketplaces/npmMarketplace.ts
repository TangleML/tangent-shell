import type { ExtensionMarketplace, MarketplaceListing } from "../types.ts";
import { installedPackageRoot, npmInstall } from "./npmInstall.ts";

/** npm registry search endpoint, filtered to Pi packages. */
const NPM_SEARCH_URL = "https://registry.npmjs.org/-/v1/search";

/** How many listings to request per search. */
const SEARCH_SIZE = 25;

/** Keyword a package must declare to appear in the Pi catalog. */
const PI_PACKAGE_KEYWORD = "pi-package";

interface NpmSearchResult {
  objects?: {
    package?: {
      name?: string;
      description?: string;
      version?: string;
      keywords?: string[];
    };
  }[];
}

/**
 * The npm marketplace: installs a registry package by spec (`pi-foo@1.2.0`,
 * `@scope/foo`) and searches the public registry, scoped to the `pi-package`
 * keyword so discovery surfaces Pi packages rather than every npm result.
 */
export class NpmMarketplace implements ExtensionMarketplace {
  readonly id = "npm";

  async install(ref: string, pkgDir: string): Promise<string> {
    const name = await npmInstall(pkgDir, ref);
    return installedPackageRoot(pkgDir, name);
  }

  async search(query: string): Promise<MarketplaceListing[]> {
    const text = `${query} keywords:${PI_PACKAGE_KEYWORD}`.trim();
    const url = `${NPM_SEARCH_URL}?text=${encodeURIComponent(text)}&size=${SEARCH_SIZE}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`npm search failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as NpmSearchResult;
    return (data.objects ?? [])
      .map((entry) => entry.package)
      .filter((pkg): pkg is NonNullable<typeof pkg> => Boolean(pkg?.name))
      .filter((pkg) => pkg.keywords?.includes(PI_PACKAGE_KEYWORD))
      .map((pkg) => ({
        ref: pkg.name as string,
        name: pkg.name as string,
        description: pkg.description,
        version: pkg.version,
      }));
  }
}
