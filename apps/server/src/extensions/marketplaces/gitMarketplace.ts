import type { ExtensionMarketplace } from "../types.ts";
import { installedPackageRoot, npmInstall } from "./npmInstall.ts";

/**
 * Normalizes a git `ref` into a spec npm understands. A value already carrying
 * a scheme (`git+`, `http(s)://`, `git://`) is passed through (prefixed with
 * `git+` when bare); a bare `host/path@ref` becomes `git+https://host/path#ref`,
 * so `github.com/user/repo@v1` installs the `v1` ref over HTTPS.
 */
export function toGitSpec(ref: string): string {
  if (
    ref.startsWith("http://") ||
    ref.startsWith("https://") ||
    ref.startsWith("git://")
  ) {
    return `git+${ref}`;
  }
  if (ref.startsWith("git+")) return ref;

  const at = ref.lastIndexOf("@");
  if (at > 0) {
    return `git+https://${ref.slice(0, at)}#${ref.slice(at + 1)}`;
  }
  return `git+https://${ref}`;
}

/** The git marketplace: installs a repository via npm's git source support. */
export class GitMarketplace implements ExtensionMarketplace {
  readonly id = "git";

  async install(ref: string, pkgDir: string): Promise<string> {
    const name = await npmInstall(pkgDir, toGitSpec(ref));
    return installedPackageRoot(pkgDir, name);
  }
}
