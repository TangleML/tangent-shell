import { useAnalytics } from "@tangent/analytics";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@tangent/ui-primitives/collapsible";
import { Icon } from "@tangent/ui-primitives/icon";
import { cn } from "@tangent/ui-primitives/utils";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import { type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";

import { useWindowContext } from "../ContentWindowStateContext";
import { useWindowDrag } from "../hooks/useWindowDrag";
import { SnapPreview } from "../SnapPreview";
import { MIN_DOCKED_HEIGHT } from "../types";
import { useWindowStore } from "../WindowStoreContext";
import { WindowActions } from "./WindowActions";
import { WindowHeader } from "./WindowHeader";

/** Height of a docked window header (px). Used to stack sticky headers. */
const HEADER_HEIGHT = 36;

export const DockedWindow = observer(function DockedWindow() {
  const { model, content, header, dockIndex = 0 } = useWindowContext();
  const { track } = useAnalytics();
  const store = useWindowStore();

  const {
    isDragging,
    snapPreview,
    panelRef,
    handleHeaderMouseDown,
    handleContainerMouseDown,
    handleContainerClick,
  } = useWindowDrag({ docked: true });

  const [isResizing, setIsResizing] = useState(false);
  const [isStuck, setIsStuck] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const stickyTop = dockIndex * HEADER_HEIGHT;

  // Detect when the header is in its "stuck" state
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsStuck(!entry.isIntersecting),
      { rootMargin: `-${stickyTop + 1}px 0px 0px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [stickyTop]);

  const handleResizeMouseDown = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);

    const startY = e.clientY;
    const startHeight = model.effectiveDockedHeight;

    const onMouseMove = (moveE: MouseEvent) => {
      const newHeight = Math.max(
        MIN_DOCKED_HEIGHT,
        startHeight + (moveE.clientY - startY),
      );
      model.updateDockedHeight(newHeight);
    };

    const onMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const handleScrollToWindow = () => {
    sentinelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const actions = <WindowActions />;
  const showCollapsedStyle = model.isMinimized || isStuck;

  if (model.isMaximized) {
    return createPortal(
      <div
        ref={panelRef}
        className="fixed inset-0 z-45 bg-background text-foreground flex flex-col rounded-none overflow-hidden"
        onMouseDown={handleContainerMouseDown}
        onClick={handleContainerClick}
      >
        <WindowHeader
          title={model.title}
          header={header}
          leadingIcon={
            <Icon
              name="PanelLeft"
              size="xs"
              className="text-muted-foreground shrink-0"
            />
          }
          actions={actions}
          className="bg-background"
        />
        <div className="flex-1 min-h-0 overflow-auto bg-background">
          {content}
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <Collapsible
      className="contents"
      open={!model.isMinimized}
      onOpenChange={(shouldExpand) => {
        const isExpanded = !model.isMinimized;
        if (shouldExpand === isExpanded) return;
        track("v2.shared_window.docked_panel_toggle_completed", {
          panel_expanded: shouldExpand,
        });
        model.toggleMinimize();
      }}
    >
      {/* Sentinel to detect stuck state and serve as scroll target */}
      <div ref={sentinelRef} className="h-0 w-full shrink-0" />

      {/* Header is a direct flex item of the dock scroll container so sticky works */}
      <CollapsibleTrigger asChild>
        <div
          ref={panelRef}
          data-dock-window={model.id}
          className={cn(
            "group/window w-full sticky text-left",
            (isDragging || isResizing) && "select-none",
            isDragging && "cursor-grabbing opacity-50",
            showCollapsedStyle
              ? "bg-accent border-b border-border"
              : "bg-background border-b border-transparent",
          )}
          style={{ top: stickyTop, zIndex: 20 - dockIndex }}
          onMouseDown={handleContainerMouseDown}
          onClick={(e) => {
            handleContainerClick();
            if (isStuck) {
              // Prefer scroll-to-window over toggling collapse when stuck.
              e.preventDefault();
              handleScrollToWindow();
            }
          }}
        >
          <WindowHeader
            title={model.title}
            header={header}
            isDragging={isDragging}
            onMouseDown={handleHeaderMouseDown}
            leadingIcon={
              <Icon
                name="GripVertical"
                size="xs"
                className="text-muted-foreground shrink-0"
              />
            }
            actions={actions}
            actionsOnHover
          />
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent className="w-full">
        <div
          className={cn(
            "w-full bg-background text-foreground",
            "transition-all duration-300",
            (isDragging || isResizing) && "select-none",
            isDragging && "opacity-50",
          )}
          style={{ minHeight: MIN_DOCKED_HEIGHT }}
          onMouseDown={handleContainerMouseDown}
          onClick={handleContainerClick}
        >
          <div className="bg-background">{content}</div>
          <div
            className="h-1 cursor-ns-resize hover:bg-muted transition-colors shrink-0"
            onMouseDown={handleResizeMouseDown}
          />
        </div>
      </CollapsibleContent>

      {isDragging &&
        snapPreview &&
        createPortal(
          <SnapPreview
            preview={snapPreview}
            windowWidth={model.size.width}
            viewportTopOffset={store.viewportTopOffset}
          />,
          document.body,
        )}
    </Collapsible>
  );
});
