import { InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";
import { cn } from "@tangent/ui-primitives/utils";
import type { CSSProperties, MouseEvent, ReactNode } from "react";

interface WindowHeaderProps {
  title: string;
  isDragging?: boolean;
  onMouseDown?: (e: MouseEvent) => void;
  leadingIcon?: ReactNode;
  /**
   * Optional override for the content region (icon + title + suffix). When set,
   * it replaces the default leading icon and title text. The chrome keeps the
   * drag behavior and reveals the actions on hover.
   */
  header?: ReactNode;
  actions: ReactNode;
  className?: string;
  style?: CSSProperties;
  actionsOnHover?: boolean;
  tone?: "light" | "dark";
}

export function WindowHeader({
  title,
  isDragging = false,
  onMouseDown,
  leadingIcon,
  header,
  actions,
  className,
  style,
  actionsOnHover = false,
  tone = "light",
}: WindowHeaderProps) {
  return (
    <div
      className={cn(
        "group/header relative flex items-center justify-between px-2 py-2.5 shrink-0 transition-all duration-300 group-hover/window:bg-purple-50",
        onMouseDown && "cursor-grab",
        onMouseDown && isDragging && "cursor-grabbing",
        className,
      )}
      style={style}
      onMouseDown={onMouseDown}
    >
      <InlineStack
        gap="1"
        blockAlign="center"
        wrap="nowrap"
        className="min-w-0 flex-1 overflow-hidden"
      >
        {header ?? (
          <>
            {leadingIcon}
            <Text
              size="xs"
              weight="semibold"
              className={cn(
                "truncate",
                tone === "dark" ? "text-gray-100" : "text-gray-700",
              )}
            >
              {title}
            </Text>
          </>
        )}
      </InlineStack>
      <div
        className={cn(
          actionsOnHover &&
            "absolute inset-y-0 right-2 flex items-center pl-3 opacity-0 transition-opacity duration-200 group-hover/window:opacity-100",
          actionsOnHover && (tone === "dark" ? "bg-gray-800" : "bg-purple-50"),
        )}
      >
        {actions}
      </div>
    </div>
  );
}
