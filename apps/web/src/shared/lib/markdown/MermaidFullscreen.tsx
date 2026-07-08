// local primitive — a fullscreen, zoom/pan viewer for a rendered Mermaid SVG.
// Renders raw DOM (portal, backdrop, transformed SVG layer) with scoped
// Tailwind, an allowed escape hatch (not Tangle UI primitives).
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";

import { IconButton } from "@/shared/ui/patterns/icon-button";

interface MermaidFullscreenProps {
  /** The rendered diagram SVG markup. */
  svg: string;
  /** Dismisses the viewer. */
  onClose: () => void;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
/** Per-click step for the zoom buttons. */
const ZOOM_STEP = 1.2;
/**
 * Wheel/trackpad zoom sensitivity. The factor scales continuously with the
 * scroll delta (`exp(-deltaY * sensitivity)`) so a two-finger pinch zooms
 * smoothly instead of jumping a fixed step per event. Lower = slower.
 */
const WHEEL_SENSITIVITY = 0.0015;

interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Fullscreen overlay (portalled to `document.body`) that displays a Mermaid
 * diagram with wheel-to-cursor zoom, drag-to-pan, zoom buttons, and a reset.
 * Escape or a backdrop click dismisses it.
 */
export function MermaidFullscreen({ svg, onClose }: MermaidFullscreenProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [transform, setTransform] = useState<Transform>({
    scale: 1,
    tx: 0,
    ty: 0,
  });

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Center the diagram in the viewport once it has measurable dimensions.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const cw = content.offsetWidth;
    const ch = content.offsetHeight;
    setTransform({ scale: 1, tx: (vw - cw) / 2, ty: (vh - ch) / 2 });
  }, [svg]);

  function zoomTo(nextScale: number, originX: number, originY: number) {
    setTransform((prev) => {
      const scale = clampScale(nextScale);
      const ratio = scale / prev.scale;
      return {
        scale,
        tx: originX - (originX - prev.tx) * ratio,
        ty: originY - (originY - prev.ty) * ratio,
      };
    });
  }

  function viewportCenter(): { x: number; y: number } {
    const box = viewportRef.current?.getBoundingClientRect();
    return box ? { x: box.width / 2, y: box.height / 2 } : { x: 0, y: 0 };
  }

  function handleWheel(e: ReactWheelEvent) {
    e.preventDefault();
    const box = viewportRef.current?.getBoundingClientRect();
    if (!box) return;
    const originX = e.clientX - box.left;
    const originY = e.clientY - box.top;
    const factor = Math.exp(-e.deltaY * WHEEL_SENSITIVITY);
    zoomTo(transform.scale * factor, originX, originY);
  }

  function handlePointerDown(e: ReactPointerEvent) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  }

  function handlePointerMove(e: ReactPointerEvent) {
    const start = dragRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setTransform((prev) => ({ ...prev, tx: prev.tx + dx, ty: prev.ty + dy }));
  }

  function handlePointerUp(e: ReactPointerEvent) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  }

  function zoomBy(factor: number) {
    const center = viewportCenter();
    zoomTo(transform.scale * factor, center.x, center.y);
  }

  function reset() {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    setTransform({
      scale: 1,
      tx: (viewport.clientWidth - content.offsetWidth) / 2,
      ty: (viewport.clientHeight - content.offsetHeight) / 2,
    });
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Diagram viewer"
      className="fixed inset-0 z-50 bg-background"
      onClick={onClose}
    >
      <div className="absolute top-3 right-3 z-10 flex gap-1 rounded-md border border-border bg-background/90 p-0.5 shadow-sm backdrop-blur">
        <IconButton
          icon="ZoomIn"
          aria-label="Zoom in"
          onClick={(e) => {
            e.stopPropagation();
            zoomBy(ZOOM_STEP);
          }}
        />
        <IconButton
          icon="ZoomOut"
          aria-label="Zoom out"
          onClick={(e) => {
            e.stopPropagation();
            zoomBy(1 / ZOOM_STEP);
          }}
        />
        <IconButton
          icon="RotateCcw"
          aria-label="Reset zoom"
          onClick={(e) => {
            e.stopPropagation();
            reset();
          }}
        />
        <IconButton
          icon="X"
          aria-label="Close diagram viewer"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        />
      </div>

      <div
        ref={viewportRef}
        className="h-full w-full cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div
          ref={contentRef}
          className="inline-block origin-top-left [&_svg]:max-w-none"
          style={{
            transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>,
    document.body,
  );
}
