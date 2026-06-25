import { BlockStack } from "@tangent/ui-primitives/layout";
import { VerticalResizeHandle } from "@tangent/ui-primitives/resize-handle";
import { cn } from "@tangent/ui-primitives/utils";
import { observer } from "mobx-react-lite";
import { type ReactNode, useEffect, useRef } from "react";

import { CollapsedDockWindowMini } from "./CollapsedDockWindowMini";
import { registerDockAreaElement } from "./snapUtils";
import {
  COLLAPSED_DOCK_AREA_WIDTH,
  MAX_DOCK_AREA_WIDTH,
  MIN_DOCK_AREA_WIDTH,
} from "./types";
import { Window } from "./Window";
import { useWindowStore } from "./WindowStoreContext";

interface DockAreaProps {
  side: "left" | "right";
  header?: ReactNode;
}

export const DockArea = observer(function DockArea({
  side,
  header,
}: DockAreaProps) {
  const windows = useWindowStore();
  const dockArea = windows.getDockAreaConfig(side);
  const { collapsed, windowOrder } = dockArea;
  const containerRef = useRef<HTMLDivElement | null>(null);

  const visibleWindows = windowOrder.filter((id) => {
    const win = windows.getWindowById(id);
    return Boolean(win) && win?.state !== "hidden";
  });
  const visibleWindowsWithMini = visibleWindows.filter((id) =>
    Boolean(windows.getWindowMiniContent(id)),
  );
  const isEmpty = visibleWindows.length === 0;

  useEffect(() => {
    windows.enableDockSide(side);
    return () => {
      windows.disableDockSide(side);
      registerDockAreaElement(side, null);
    };
  }, [side]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || collapsed || isEmpty) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = entry.contentRect.width;
        if (
          newWidth > 0 &&
          Math.abs(newWidth - windows.getDockAreaWidth(side)) > 1
        ) {
          windows.setDockAreaWidth(side, Math.round(newWidth));
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [side, collapsed, isEmpty]);

  if (isEmpty) return null;

  const setRef = (element: HTMLDivElement | null) => {
    containerRef.current = element;
    registerDockAreaElement(side, element);
  };

  const handleToggleCollapse = () => {
    windows.toggleDockAreaCollapsed(side);
  };

  const handleSide = side === "left" ? "right" : "left";

  if (collapsed) {
    return (
      <div
        ref={setRef}
        data-dock-area={side}
        className={cn("relative shrink-0 bg-muted flex flex-col")}
        style={{ width: COLLAPSED_DOCK_AREA_WIDTH }}
      >
        <BlockStack
          gap="1"
          align="center"
          className="relative z-20 min-h-0 flex-1 overflow-y-auto overflow-x-hidden hide-scrollbar py-1 px-0.5"
        >
          {visibleWindowsWithMini.map((windowId) => (
            <CollapsedDockWindowMini
              key={windowId}
              windowId={windowId}
              dockSide={side}
            />
          ))}
        </BlockStack>
        <VerticalResizeHandle
          side={handleSide}
          minWidth={COLLAPSED_DOCK_AREA_WIDTH}
          maxWidth={COLLAPSED_DOCK_AREA_WIDTH}
          onDoubleClick={handleToggleCollapse}
        />
      </div>
    );
  }

  return (
    <div
      ref={setRef}
      data-dock-area={side}
      className={cn("relative shrink-0 bg-background flex flex-col")}
      style={{ width: dockArea.width }}
    >
      {header ? <div className="shrink-0">{header}</div> : null}
      <div
        data-dock-scroll
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden hide-scrollbar"
      >
        <BlockStack>
          {visibleWindows.map((windowId, index) => (
            <Window
              key={windowId}
              windowId={windowId}
              docked
              dockIndex={index}
            />
          ))}
        </BlockStack>
      </div>

      <VerticalResizeHandle
        side={handleSide}
        minWidth={MIN_DOCK_AREA_WIDTH}
        maxWidth={MAX_DOCK_AREA_WIDTH}
        onDoubleClick={handleToggleCollapse}
      />
    </div>
  );
});
