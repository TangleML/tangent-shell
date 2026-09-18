/**
 * The single esbuild configuration for compiling a UI extension entry to the
 * ESM asset the sandbox worker loads. Shared by the server (on bundle upload)
 * and the `ui-extensions` CLI (local build), so a component that builds locally
 * builds identically on the server.
 *
 * Transpile-bundle only: relative sibling imports (helpers, shared logic) are
 * inlined, while bare imports (`react`, `react/jsx-runtime`,
 * `@tangent/ui-extensions-sdk`) are left external for the worker's import map to
 * resolve at runtime. The component never executes here.
 */

import { build, type BuildOptions } from "esbuild";

/**
 * Bare specifiers the sandbox worker injects at runtime. They must stay external
 * even when resolvable at build time — otherwise a locally installed (workspace-
 * symlinked) `@tangent/ui-extensions-sdk` would get inlined, diverging from the
 * server build (whose temp dir can't resolve it) and shadowing the real runtime.
 */
const WORKER_PROVIDED = [
  "react",
  "react/*",
  "react-dom",
  "react-dom/*",
  "@tangent/ui-extensions-sdk",
  "@tangent/ui-extensions-sdk/*",
];

/** esbuild options for compiling a single UI extension `entry` to ESM. */
export function uiComponentBuildOptions(entryPath: string): BuildOptions {
  return {
    entryPoints: [entryPath],
    bundle: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    // Everything bare stays external for the worker's import map; the explicit
    // list also covers workspace-symlinked packages `packages: "external"` alone
    // would otherwise resolve outside node_modules and bundle.
    packages: "external",
    external: WORKER_PROVIDED,
    write: false,
    logLevel: "silent",
  };
}

/** Thrown when a UI extension entry fails to compile. */
export class UiComponentBuildError extends Error {
  readonly entry: string;

  constructor(entry: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`failed to compile ui entry "${entry}"\n${detail}`, { cause });
    this.name = "UiComponentBuildError";
    this.entry = entry;
  }
}

/**
 * Transpile-bundles a single UI extension entry and returns the ESM source.
 * Throws {@link UiComponentBuildError} when the entry fails to compile.
 */
export async function buildUiComponent(entryPath: string): Promise<string> {
  try {
    const result = await build(uiComponentBuildOptions(entryPath));
    return result.outputFiles![0].text;
  } catch (err) {
    throw new UiComponentBuildError(entryPath, err);
  }
}
