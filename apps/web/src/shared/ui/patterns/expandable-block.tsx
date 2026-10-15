import { Button } from "@tangent/ui-primitives/button";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack } from "@tangent/ui-primitives/layout";
import { cva } from "class-variance-authority";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { cn } from "@/shared/lib/utils";

/**
 * ExpandableBlock — Layer 3 semantic primitive.
 *
 * Caps tall content at a fixed height and pairs it with a real expand/collapse
 * button, so a clipped block reads as a control instead of a rendering bug. The
 * button only appears once the content actually overflows the cap.
 */

type Clamp = "sm" | "md";

const CLAMP_PX: Record<Clamp, number> = { sm: 112, md: 256 };

const clampVariants = cva("w-full min-w-0", {
  variants: {
    clamp: { sm: "", md: "" },
    clamped: {
      true: "cursor-pointer overflow-hidden [-webkit-mask-image:linear-gradient(to_bottom,black_55%,transparent_100%)] [mask-image:linear-gradient(to_bottom,black_55%,transparent_100%)]",
      false: "",
    },
  },
  compoundVariants: [
    { clamp: "sm", clamped: true, className: "max-h-28" },
    { clamp: "md", clamped: true, className: "max-h-64" },
  ],
});

const expandedKeys = new Set<string>();

interface ExpandableBlockProps {
  /** Collapsed height — `sm` for notes, `md` for code. @default "sm" */
  clamp?: Clamp;
  /** Names the content in the control, e.g. `"note"` → "Show full note". */
  noun?: string;
  /** Stable id that keeps the expanded state across unmounts. */
  persistKey?: string;
  children: ReactNode;
}

export function ExpandableBlock({
  clamp = "sm",
  noun,
  persistKey,
  children,
}: ExpandableBlockProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(
    () => persistKey != null && expandedKeys.has(persistKey),
  );
  const [overflowing, setOverflowing] = useState(false);
  const contentId = useId();

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setOverflowing(el.scrollHeight > CLAMP_PX[clamp] + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [clamp]);

  const clamped = overflowing && !expanded;

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (persistKey == null) return;
    if (next) expandedKeys.add(persistKey);
    else expandedKeys.delete(persistKey);
  }

  function handleContentClick() {
    if (!clamped) return;
    if (globalThis.getSelection()?.isCollapsed === false) return;
    toggle();
  }

  return (
    <BlockStack gap="1">
      <div
        id={contentId}
        ref={contentRef}
        className={cn(clampVariants({ clamp, clamped }))}
        onClick={handleContentClick}
      >
        {children}
      </div>
      {overflowing ? (
        <Button
          variant="ghost"
          size="xs"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={contentId}
        >
          <Icon name={expanded ? "ChevronsDownUp" : "ChevronDown"} size="xs" />
          {expanded ? "Show less" : noun ? `Show full ${noun}` : "Show more"}
        </Button>
      ) : null}
    </BlockStack>
  );
}
