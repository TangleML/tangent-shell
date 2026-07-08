// local primitive — renders a Mermaid diagram as raw SVG injected into a
// wrapper element, so the scoped Tailwind classes here are an allowed escape
// hatch (not Tangle UI primitives).
import { useLayoutEffect, useRef, useState } from "react";

import { useTheme } from "@/shared/theme/themeContext";
import { HoverReveal } from "@/shared/ui/patterns/hover-reveal";
import { IconButton } from "@/shared/ui/patterns/icon-button";

import { CodeBlock } from "./CodeBlock";
import { MermaidFullscreen } from "./MermaidFullscreen";
import { MermaidLoupe } from "./MermaidLoupe";
import { mermaidThemeFor, useMermaidSvg } from "./useMermaidSvg";

/** Fractions of the viewport the inline diagram may occupy in each dimension. */
const MAX_WIDTH_FRACTION = 0.9;
const MAX_HEIGHT_FRACTION = 0.85;

/**
 * Sizes the rendered diagram up to its natural dimensions, capped to a fraction
 * of the viewport in *both* width and height, so it never overflows one screen
 * in either direction. Overrides mermaid's `max-width` (which let the narrow
 * chat bubble shrink it below readability) and re-fits on window resize. The
 * fullscreen viewer remains available for anything larger.
 */
function useFitToScreen(
  svgRef: React.RefObject<HTMLDivElement | null>,
  svg: string,
) {
  useLayoutEffect(() => {
    const el = svgRef.current?.querySelector<SVGSVGElement>("svg");
    const box = el?.viewBox.baseVal;
    if (!el || !box || box.width === 0 || box.height === 0) return;

    const node = el;
    const vbWidth = box.width;
    const vbHeight = box.height;

    function fit() {
      const maxWidth = window.innerWidth * MAX_WIDTH_FRACTION;
      const maxHeight = window.innerHeight * MAX_HEIGHT_FRACTION;
      const scale = Math.min(1, maxWidth / vbWidth, maxHeight / vbHeight);
      node.style.maxWidth = "none";
      node.style.width = `${vbWidth * scale}px`;
      node.style.height = `${vbHeight * scale}px`;
    }

    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [svgRef, svg]);
}

interface MermaidDiagramProps {
  code: string;
  /**
   * Whether the source is still streaming in. While true, the block may be a
   * half-written, transiently-valid diagram, so rendering is deferred until
   * streaming completes — this avoids the diagram/code-block flicker.
   */
  isStreaming?: boolean;
}

/**
 * Renders a fenced ```mermaid block as an SVG diagram. Mermaid is loaded lazily
 * and re-rendered when the source or active theme changes.
 *
 * Agent output streams in token-by-token, so the source is frequently
 * incomplete mid-stream. Rendering is gated on streaming completion (see
 * {@link useMermaidSvg}); until a diagram is available the raw source is shown
 * as a code block, and on a hard failure the parse error is shown alongside it.
 *
 * Once rendered, the diagram exposes a hover toolbar with a magnifier loupe and
 * a fullscreen zoom/pan viewer for dense, hard-to-read diagrams.
 */
export function MermaidDiagram({
  code,
  isStreaming = false,
}: MermaidDiagramProps) {
  const { theme } = useTheme();
  const svgRef = useRef<HTMLDivElement>(null);
  const [loupeOn, setLoupeOn] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const { svg, failed, errorText } = useMermaidSvg({
    code,
    theme: mermaidThemeFor(theme),
    enabled: !isStreaming,
  });

  useFitToScreen(svgRef, svg ?? "");

  if (svg == null) {
    return (
      <div>
        {failed && errorText ? (
          <pre className="my-1 overflow-auto rounded-md bg-red-950 p-2 text-xs text-red-200">
            mermaid error: {errorText}
          </pre>
        ) : null}
        <CodeBlock
          code={code}
          language="mermaid"
          showLineNumbers={false}
          className="my-1 h-auto max-h-64 rounded-md text-xs"
        />
      </div>
    );
  }

  return (
    <div className="group relative my-2">
      <div className="overflow-auto">
        <div className="relative mx-auto w-fit">
          <div ref={svgRef} dangerouslySetInnerHTML={{ __html: svg }} />
          {loupeOn ? <MermaidLoupe svg={svg} targetRef={svgRef} /> : null}
        </div>
      </div>

      <div className="absolute top-1.5 right-1.5 z-20">
        <HoverReveal>
          <div className="flex gap-0.5 rounded-md border border-border bg-background/80 p-0.5 backdrop-blur">
            <IconButton
              icon="Search"
              aria-label={loupeOn ? "Turn off magnifier" : "Magnify diagram"}
              aria-pressed={loupeOn}
              variant={loupeOn ? "subtle" : "ghost"}
              onClick={() => setLoupeOn((v) => !v)}
            />
            <IconButton
              icon="Maximize2"
              aria-label="Open diagram fullscreen"
              variant="ghost"
              onClick={() => setFullscreen(true)}
            />
          </div>
        </HoverReveal>
      </div>

      {fullscreen ? (
        <MermaidFullscreen svg={svg} onClose={() => setFullscreen(false)} />
      ) : null}
    </div>
  );
}
