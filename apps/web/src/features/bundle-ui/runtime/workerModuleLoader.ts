/**
 * Worker-side loader for compiled bundle components (Phase 3 output).
 *
 * The server transpiles author `.tsx` with `packages: "external"`, so the served
 * JS keeps bare imports (`react`, `react/jsx-runtime`,
 * `@tangent/ui-extensions-sdk`).
 * Dedicated module workers cannot use import maps, so we resolve those bare
 * specifiers ourselves: the worker bundles its own copies of these modules, and
 * this loader exposes them to the dynamically-imported component via tiny
 * `blob:` re-export shims, then rewrites the component's import specifiers to
 * point at those shims before importing it.
 *
 * This is the "worker import map" the Phase-3 compile comment anticipates.
 */

const MODULE_REGISTRY_KEY = "__TANGENT_BUNDLE_UI_MODULES__";

type Namespace = Record<string, unknown>;

declare global {
  var __TANGENT_BUNDLE_UI_MODULES__: Record<string, Namespace> | undefined;
}

const VALID_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Cache shim blob URLs by specifier so we make one per module, not per load. */
const shimUrlCache = new Map<string, string>();

/**
 * Builds a `blob:` ESM module that re-exports the live worker namespace stored
 * under `specifier` in the global registry. Named exports are enumerated from
 * the namespace; a default export falls back to the namespace itself.
 */
function shimUrlFor(specifier: string): string {
  const cached = shimUrlCache.get(specifier);
  if (cached) return cached;

  const ns = globalThis.__TANGENT_BUNDLE_UI_MODULES__?.[specifier] ?? {};
  const names = Object.keys(ns).filter(
    (key) => key !== "default" && VALID_IDENTIFIER.test(key),
  );

  const source = [
    `const __m = globalThis[${JSON.stringify(MODULE_REGISTRY_KEY)}][${JSON.stringify(specifier)}];`,
    ...names.map(
      (name) => `export const ${name} = __m[${JSON.stringify(name)}];`,
    ),
    `export default (__m && "default" in __m ? __m.default : __m);`,
  ].join("\n");

  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  shimUrlCache.set(specifier, url);
  return url;
}

/** Rewrites each known bare import specifier in `code` to its shim blob URL. */
function rewriteImports(code: string, specifiers: readonly string[]): string {
  // Longest first so `react/jsx-runtime` is rewritten before `react`.
  const ordered = [...specifiers].sort((a, b) => b.length - a.length);
  let out = code;
  for (const specifier of ordered) {
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `(from|import)(\\s*\\(?\\s*)(["'])${escaped}\\3`,
      "g",
    );
    const url = shimUrlFor(specifier);
    out = out.replace(
      pattern,
      (_match, keyword, middle, quote) =>
        `${keyword}${middle}${quote}${url}${quote}`,
    );
  }
  return out;
}

/**
 * Registers the worker's own module namespaces so the shims can re-export them.
 * Call once at worker startup, before loading any component.
 */
export function registerWorkerModules(
  modules: Record<string, Namespace>,
): void {
  globalThis.__TANGENT_BUNDLE_UI_MODULES__ = {
    ...globalThis.__TANGENT_BUNDLE_UI_MODULES__,
    ...modules,
  };
}

/**
 * Fetches the compiled component JS, resolves its bare imports against the
 * registered worker modules, and imports it. Returns the module's default
 * export (the component), throwing a descriptive error if it is missing.
 */
export async function loadComponent(
  moduleUrl: string,
): Promise<(props: Record<string, unknown>) => unknown> {
  const specifiers = Object.keys(
    globalThis.__TANGENT_BUNDLE_UI_MODULES__ ?? {},
  );

  const response = await fetch(moduleUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `bundle-ui: failed to load component (${response.status} ${response.statusText})`,
    );
  }
  const source = await response.text();
  const rewritten = rewriteImports(source, specifiers);

  const blobUrl = URL.createObjectURL(
    new Blob([rewritten], { type: "text/javascript" }),
  );
  try {
    const module = (await import(/* @vite-ignore */ blobUrl)) as {
      default?: (props: Record<string, unknown>) => unknown;
    };
    if (typeof module.default !== "function") {
      throw new Error("bundle-ui: component module has no default export");
    }
    return module.default;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
