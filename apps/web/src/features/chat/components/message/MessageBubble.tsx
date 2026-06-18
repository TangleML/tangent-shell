// local primitive — chat message bubble (alignment + tonal background per
// author). Styles a raw <div>, so it is exempt from
// tangle-ui/no-classname-on-primitives.
import { cva, type VariantProps } from "class-variance-authority";
import type { PropsWithChildren } from "react";

import { cn } from "@/shared/lib/utils";

const messageBubbleVariants = cva(
  "flex w-full flex-col gap-1 rounded-lg px-3 py-2 min-w-0",
  {
    variants: {
      variant: {
        own: "bg-primary/10 text-foreground",
        human: "bg-primary/10",
        agent:
          "bg-message-surface text-message-surface-foreground border border-message-surface-border",
        memory: "bg-accent/60 border border-accent-foreground/20",
      },
    },
    defaultVariants: {
      variant: "human",
    },
  },
);

export type MessageBubbleVariant = NonNullable<
  VariantProps<typeof messageBubbleVariants>["variant"]
>;

interface MessageBubbleProps
  extends PropsWithChildren, VariantProps<typeof messageBubbleVariants> {
  className?: string;
  /** When false, native text selection is disabled (e.g. collapsed thinking). */
  selectable?: boolean;
}

export function MessageBubble({
  variant,
  className,
  selectable = true,
  children,
}: MessageBubbleProps) {
  return (
    <div
      className={cn(
        messageBubbleVariants({ variant }),
        !selectable && "select-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
