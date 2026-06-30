// local primitive — a circular magnifier ("loupe") that follows the cursor over
// a rendered Mermaid SVG, showing a zoomed copy of the area beneath it. Raw DOM
// with scoped Tailwind, an allowed escape hatch (not Tangle UI primitives).
import { type RefObject, useEffect, useRef, useState } from "react";

interface MermaidLoupeProps {
  /** The rendered diagram SVG markup (duplicated, scaled, inside the lens). */
  svg: string;
  /**
   * The element whose rendered box defines the magnified content and the
   * coordinate space the cursor is tracked in (the visible diagram wrapper).
   */
  targetRef: RefObject<HTMLElement | null>;
}

/** Lens radius in CSS px. */
const RADIUS = 190;
/**
 * Extra magnification past the diagram's intrinsic (1:1) size, so labels are
 * comfortably readable rather than merely native-sized.
 */
const READABILITY = 0.55;
/** Floor so small diagrams (shown near 1:1) still get a useful magnification. */
const MIN_ZOOM = 2.5;
/** Ceiling so a heavily-shrunk diagram doesn't zoom to an unusable degree. */
const MAX_ZOOM = 12;

interface LensState {
  /** Cursor position relative to the target's top-left, in CSS px. */
  x: number;
  y: number;
  /** Rendered size of the target box, in CSS px. */
  w: number;
  h: number;
  /** Magnification of the content under the cursor (see {@link readableZoom}). */
  zoom: number;
}

/**
 * Magnification needed to bring the diagram up to a readable size. A large
 * diagram is scaled down to fit its container, so we magnify by roughly that
 * shrink ratio (`intrinsic width / rendered width`) to restore native size,
 * then a bit more for legibility — clamped to a sensible range.
 */
function readableZoom(target: HTMLElement): number {
  const rect = target.getBoundingClientRect();
  const svg = target.querySelector("svg");
  const intrinsicWidth = svg?.viewBox.baseVal.width || rect.width;
  const shrink = rect.width > 0 ? intrinsicWidth / rect.width : 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, shrink * READABILITY));
}

/**
 * Tracks the pointer over `targetRef` and renders a round magnified copy of the
 * diagram under the cursor. Inert to pointer events so it never blocks the
 * underlying controls.
 */
export function MermaidLoupe({ svg, targetRef }: MermaidLoupeProps) {
  const [lens, setLens] = useState<LensState | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    function update(e: PointerEvent) {
      const el = targetRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setLens({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        w: rect.width,
        h: rect.height,
        zoom: readableZoom(el),
      });
    }

    function handleMove(e: PointerEvent) {
      if (frameRef.current != null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        update(e);
      });
    }

    function handleLeave() {
      setLens(null);
    }

    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerleave", handleLeave);
    return () => {
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerleave", handleLeave);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [targetRef]);

  if (!lens) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10 overflow-hidden rounded-full border-2 border-border bg-background shadow-lg"
      style={{
        width: RADIUS * 2,
        height: RADIUS * 2,
        left: lens.x - RADIUS,
        top: lens.y - RADIUS,
      }}
    >
      <div
        className="absolute origin-top-left [&_svg]:!h-full [&_svg]:!w-full [&_svg]:!max-w-none"
        style={{
          width: lens.w * lens.zoom,
          height: lens.h * lens.zoom,
          left: RADIUS - lens.x * lens.zoom,
          top: RADIUS - lens.y * lens.zoom,
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
