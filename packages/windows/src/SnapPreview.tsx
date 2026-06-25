import type { SnapPreviewType } from "./types";

interface SnapPreviewProps {
  preview: SnapPreviewType;
  windowWidth: number;
  viewportTopOffset: number;
}

/**
 * Visual feedback overlay shown during window drag operations.
 * Displays where the window will snap to if released.
 */
export function SnapPreview({
  preview,
  windowWidth,
  viewportTopOffset,
}: SnapPreviewProps) {
  if (preview.type === "edge") {
    return (
      <EdgeDockPreview
        side={preview.side}
        windowWidth={windowWidth}
        viewportTopOffset={viewportTopOffset}
      />
    );
  }

  if (preview.type === "dock-insert") {
    return (
      <DockInsertPreview
        indicatorY={preview.indicatorY}
        areaLeft={preview.areaLeft}
        areaWidth={preview.areaWidth}
      />
    );
  }

  return null;
}

interface EdgeDockPreviewProps {
  side: "left" | "right";
  windowWidth: number;
  viewportTopOffset: number;
}

function EdgeDockPreview({
  side,
  windowWidth,
  viewportTopOffset,
}: EdgeDockPreviewProps) {
  const viewportHeight = window.innerHeight - viewportTopOffset;

  return (
    <div
      className="fixed pointer-events-none z-[100] bg-primary/20 border-2 border-primary/50 border-dashed rounded-lg transition-all duration-150"
      style={{
        left: side === "left" ? 0 : window.innerWidth - windowWidth,
        top: viewportTopOffset,
        width: windowWidth,
        height: viewportHeight,
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-primary/80 text-primary-foreground text-xs px-2 py-1 rounded font-medium">
          Dock {side}
        </div>
      </div>
    </div>
  );
}

interface DockInsertPreviewProps {
  indicatorY: number;
  areaLeft: number;
  areaWidth: number;
}

/**
 * Horizontal line indicator showing where a window will be inserted in a dock area.
 */
function DockInsertPreview({
  indicatorY,
  areaLeft,
  areaWidth,
}: DockInsertPreviewProps) {
  const padding = 8;
  return (
    <div
      className="fixed pointer-events-none z-[100] transition-all duration-75"
      style={{
        left: areaLeft + padding,
        top: indicatorY - 2,
        width: areaWidth - padding * 2,
        height: 4,
      }}
    >
      <div className="h-full bg-primary rounded-full" />
      <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-primary rounded-full border-2 border-background" />
    </div>
  );
}
