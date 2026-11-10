import { InlineStack } from "@tangent/ui-primitives/layout";
import { cva, type VariantProps } from "class-variance-authority";
import {
  forwardRef,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type PropsWithChildren,
  type ReactNode,
  type Ref,
} from "react";

import { cn } from "@/shared/lib/utils";

/**
 * ListRow — Layer 3 semantic primitive.
 *
 * Horizontal row inside a list. Composes InlineStack + the `group` class so that
 * children can use `HoverReveal` and group-hover-aware styling.
 *
 * Replaces the recurring `<InlineStack className="group hover:bg-* px-* py-*">` pattern
 * (~18 hits across v2).
 */

const listRowVariants = cva("group w-full rounded-sm transition-colors", {
  variants: {
    density: {
      compact: "px-1 py-0.5",
      cozy: "px-2 py-1",
      comfortable: "px-3 py-2",
    },
    hoverable: {
      true: "hover:bg-muted/60 cursor-pointer",
      false: "",
    },
    selected: {
      true: "bg-muted border-primary",
      false: "",
    },
    zebra: {
      true: "even:bg-muted/30",
      false: "",
    },
    border: {
      none: "",
      sm: "border rounded-sm",
    },
  },
  defaultVariants: {
    border: "none",
    density: "cozy",
    hoverable: false,
    selected: false,
    zebra: false,
  },
});

/**
 * Negative margins applied to the prefix slot so it bleeds past the row's
 * own padding, spanning the full border-box height and sitting flush against
 * the leading edge. Must mirror the per-density padding above.
 */
const prefixBleedVariants = cva("flex shrink-0 items-stretch self-stretch", {
  variants: {
    density: {
      compact: "-my-0.5 -ms-1",
      cozy: "-my-1 -ms-2",
      comfortable: "-my-2 -ms-3",
    },
  },
  defaultVariants: {
    density: "cozy",
  },
});

type ListRowVariantProps = VariantProps<typeof listRowVariants>;

interface ListRowProps extends ListRowVariantProps {
  as?: "li" | "div";
  onClick?: MouseEventHandler<HTMLElement>;
  /** Inter-item gap. @default '2' */
  gap?: "0" | "0.5" | "1" | "1.5" | "2" | "3" | "4" | "5" | "6" | "8";
  /**
   * Leading slot rendered flush against the row's edges. It bleeds past the
   * row padding to span the full row height, producing a "prefix" strip
   * (e.g. a tinted icon column). The row clips overflow so the prefix inherits
   * the row's rounded corners.
   */
  prefix?: ReactNode;
  /**
   * Makes the whole row an external link opening in a new tab, via an anchor
   * stretched over the row; the row's own buttons stay clickable above it.
   */
  link?: { href: string; label: string };
}

/** Lifts the row's own buttons above the stretched link so they stay clickable. */
const LINK_ROW_CLASS = "relative [&_button]:relative [&_button]:z-10";

const STRETCHED_LINK_CLASS =
  "absolute inset-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50";

export const ListRow = forwardRef<HTMLElement, PropsWithChildren<ListRowProps>>(
  function ListRow(
    {
      children,
      as: Element = "div",
      density = "cozy",
      hoverable = false,
      selected = false,
      zebra = false,
      border = "none",
      onClick,
      gap = "2",
      prefix,
      link,
    },
    ref,
  ) {
    const isInteractive = hoverable || onClick != null || link != null;
    const handleKeyDown: KeyboardEventHandler<HTMLElement> | undefined = onClick
      ? (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClick(event as unknown as Parameters<typeof onClick>[0]);
          }
        }
      : undefined;
    return (
      <Element
        ref={ref as Ref<any>}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        className={cn(
          listRowVariants({
            density,
            hoverable: isInteractive,
            selected,
            zebra,
            border,
          }),
          prefix != null && "overflow-hidden",
          link != null && LINK_ROW_CLASS,
        )}
      >
        {link != null ? (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={link.label}
            className={STRETCHED_LINK_CLASS}
          />
        ) : null}
        <InlineStack gap={gap} wrap="nowrap" blockAlign="center">
          {prefix != null ? (
            <div className={cn(prefixBleedVariants({ density }))}>{prefix}</div>
          ) : null}
          {children}
        </InlineStack>
      </Element>
    );
  },
);

ListRow.displayName = "ListRow";
