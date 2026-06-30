import { useEffect, useState } from "react";

/**
 * Mermaid's `theme` option only distinguishes light from dark; the dark-derived
 * app themes (xterm, piforge) all map to mermaid's `"dark"`.
 */
export type MermaidTheme = "default" | "dark";

export function mermaidThemeFor(theme: string): MermaidTheme {
  return theme === "light" ? "default" : "dark";
}

/**
 * Per-call render id. `mermaid.render(id, ...)` derives a temporary DOM node
 * from this id; reusing one id across the rapid, overlapping effect runs that
 * streaming (and StrictMode's double-invoke) trigger makes those concurrent
 * renders collide on the same node and throw. A fresh id per call keeps them
 * isolated. The `mermaid-` prefix keeps it a valid CSS selector.
 */
let renderCounter = 0;

/** Removes any temporary nodes a failed `mermaid.render` left attached to the body. */
function removeMermaidArtifacts(id: string): void {
  document.getElementById(id)?.remove();
  document.getElementById(`d${id}`)?.remove();
}

interface UseMermaidSvgOptions {
  code: string;
  theme: MermaidTheme;
  /**
   * Gates rendering. When `false` (e.g. the source is still streaming in
   * token-by-token), the parse/render is skipped so we never flash a diagram
   * built from a half-written, transiently-valid block.
   */
  enabled: boolean;
}

interface UseMermaidSvgResult {
  svg: string | null;
  failed: boolean;
  errorText: string | null;
}

/**
 * Lazily loads mermaid and renders `code` to an SVG string, re-rendering when
 * the source or active theme changes. Mermaid is dynamically imported to keep
 * it out of the main bundle.
 *
 * The last successfully-rendered SVG is retained across re-renders, so a
 * transient parse failure (or a disabled pass) never drops a good diagram back
 * to nothing.
 */
export function useMermaidSvg({
  code,
  theme,
  enabled,
}: UseMermaidSvgOptions): UseMermaidSvgResult {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const id = `mermaid-${(renderCounter += 1)}`;

    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme,
        });
        await mermaid.parse(code);
        const { svg: rendered } = await mermaid.render(id, code);
        if (cancelled) return;
        setSvg(rendered);
        setFailed(false);
        setErrorText(null);
      } catch (error) {
        removeMermaidArtifacts(id);
        if (cancelled) return;
        console.error("[MermaidDiagram] render failed", error);
        setErrorText(error instanceof Error ? error.message : String(error));
        setFailed(true);
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [code, theme, enabled]);

  return { svg, failed, errorText };
}
