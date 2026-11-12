import { Icon, type IconName } from "@tangent/ui-primitives/icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@tangent/ui-primitives/popover";
import { Text } from "@tangent/ui-primitives/typography";
import { type ReactNode, type Ref, useId } from "react";

import { cn } from "@/shared/lib/utils";
import { IconButton } from "@/shared/ui/patterns/icon-button";
import { Pill } from "@/shared/ui/patterns/pill";

/**
 * ListItem — Layer 3 semantic primitive.
 *
 * One item design for every list of openable things: icon tile, title over
 * subtitle, a read-only flair, and actions that take the flair's spot on hover.
 * Until then the actions take no room, so the title truncates at the column's
 * edge rather than short of it.
 * The row's slots take data instead of markup, so call sites can't restyle it.
 */

/** `label` is announced to screen readers; only the pill shows it. */
export type ListItemFlair =
  | {
      kind: "dot";
      label: string;
      tone?: "subdued" | "success" | "warning" | "critical";
      pulse?: boolean;
    }
  | {
      kind: "icon";
      icon: IconName;
      label: string;
      tone?: "subdued" | "success" | "warning" | "critical";
    }
  | {
      kind: "pill";
      label: string;
      tone?: "subdued" | "info" | "success" | "warning" | "critical";
    };

export interface ListItemAction {
  icon: IconName;
  /** Accessible name, also used as the key, so keep it unique per item. */
  label: string;
  onClick: () => void;
  tone?: "default" | "success" | "critical";
  disabled?: boolean;
}

export interface ListItemMenu {
  /** Accessible name for the "more" button. */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  content: ReactNode;
}

interface ListItemProps {
  ref?: Ref<HTMLLIElement>;
  /** A Lucide icon, or an image such as an agent bundle's icon. */
  icon: IconName | { src: string; alt: string };
  title: string;
  subtitle?: string;
  flair?: ListItemFlair;
  actions?: ListItemAction[];
  /** A "more" button after the actions; `content` renders in its popover. */
  menu?: ListItemMenu;
  /** Tints the icon tile when the item needs attention. */
  tone?: "default" | "critical";
  /** The item whose view is currently open. */
  selected?: boolean;
  /** The title stands in for missing content, e.g. "No instructions yet". */
  placeholder?: boolean;
  /** Can't be opened right now; actions stay available. */
  disabled?: boolean;
  /** Omit for display-only items. */
  onOpen?: () => void;
}

const TILE_TONE = {
  default: "bg-foreground/8 text-muted-foreground",
  critical: "bg-destructive/10 text-destructive",
} as const;

const DOT_TONE = {
  subdued: "bg-muted-foreground",
  success: "bg-success",
  warning: "bg-warning",
  critical: "bg-destructive",
} as const;

function FlairContent({ flair }: { flair: ListItemFlair }) {
  switch (flair.kind) {
    case "dot":
      return (
        <>
          <span
            className={cn(
              "size-2 rounded-full",
              DOT_TONE[flair.tone ?? "subdued"],
              flair.pulse && "animate-pulse motion-reduce:animate-none",
            )}
          />
          <span className="sr-only">{flair.label}</span>
        </>
      );
    case "icon":
      return (
        <>
          <Icon name={flair.icon} size="sm" tone={flair.tone ?? "subdued"} />
          <span className="sr-only">{flair.label}</span>
        </>
      );
    case "pill":
      return (
        <Pill size="xs" tone={flair.tone ?? "subdued"}>
          {flair.label}
        </Pill>
      );
  }
}

export function ListItem({
  ref,
  icon,
  title,
  subtitle,
  flair,
  actions = [],
  menu,
  tone = "default",
  selected = false,
  placeholder = false,
  disabled = false,
  onOpen,
}: ListItemProps) {
  const flairId = useId();
  const openable = onOpen !== undefined && !disabled;
  const hasActions = actions.length > 0 || menu !== undefined;
  // Focus moves into the portaled popover, so pin the actions while it's open.
  const menuOpen = menu?.open ?? false;
  // With no open button to focus first, hidden actions could never take keyboard focus.
  const inlineActions = hasActions && !openable;
  // Translucent rather than `bg-muted`, so selection reads on whatever surface
  // the list sits on, including a host page showing through an embed.
  const rowBackground = selected
    ? "bg-foreground/10"
    : openable && "hover:bg-foreground/5";

  const body = (
    <>
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-sm",
          TILE_TONE[tone],
        )}
      >
        {typeof icon === "string" ? (
          <Icon name={icon} size="lg" />
        ) : (
          <img
            src={icon.src}
            alt={icon.alt}
            className="size-6 rounded-sm object-contain"
          />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <Text
          size="sm"
          weight="medium"
          tone={placeholder ? "subdued" : undefined}
          truncate
          title={title}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text size="xs" tone="subdued" truncate title={subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </span>
    </>
  );

  return (
    <li
      ref={ref}
      className={cn(
        "group/item relative grid w-full grid-cols-[minmax(0,1fr)_auto] rounded-md transition-colors motion-reduce:transition-none",
        rowBackground,
      )}
    >
      {onOpen ? (
        <button
          type="button"
          disabled={disabled}
          aria-current={selected || undefined}
          aria-describedby={flair ? flairId : undefined}
          onClick={onOpen}
          className="flex min-w-0 cursor-pointer items-center gap-3 p-2 text-start outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset disabled:cursor-default disabled:opacity-50"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-3 p-2">{body}</div>
      )}
      {flair || hasActions ? (
        <div
          className={cn(
            "pointer-events-none relative h-5 pe-2",
            inlineActions
              ? "flex gap-1"
              : "grid pointer-coarse:flex pointer-coarse:gap-1",
            subtitle ? "mt-2 self-start" : "self-center",
          )}
        >
          {hasActions ? (
            <div
              className={cn(
                "pointer-events-auto items-center justify-end gap-1 [grid-area:1/1]",
                menuOpen || inlineActions
                  ? "flex"
                  : "hidden group-focus-within/item:flex group-hover/item:flex pointer-coarse:flex",
              )}
            >
              {actions.map((action) => (
                <IconButton
                  key={action.label}
                  icon={action.icon}
                  tone={action.tone}
                  disabled={action.disabled}
                  aria-label={action.label}
                  onClick={action.onClick}
                />
              ))}
              {menu ? (
                <Popover open={menu.open} onOpenChange={menu.onOpenChange}>
                  <PopoverTrigger asChild>
                    <IconButton
                      icon="EllipsisVertical"
                      aria-label={menu.label}
                    />
                  </PopoverTrigger>
                  <PopoverContent align="end">{menu.content}</PopoverContent>
                </Popover>
              ) : null}
            </div>
          ) : null}
          {flair ? (
            <div
              id={flairId}
              className={cn(
                "flex items-center justify-end transition-opacity duration-150 [grid-area:1/1] motion-reduce:transition-none",
                hasActions &&
                  !inlineActions &&
                  (menuOpen
                    ? "pointer-fine:opacity-0"
                    : "group-hover/item:opacity-0 pointer-fine:group-focus-within/item:opacity-0"),
              )}
            >
              <FlairContent flair={flair} />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

ListItem.displayName = "ListItem";
