// local primitive — chat message bubble (alignment + tonal background per
// author). Styles a raw <div>, so it is exempt from
// tangle-ui/no-classname-on-primitives.
import { cva, type VariantProps } from "class-variance-authority";
import type { PropsWithChildren } from "react";

import { cn } from "@/shared/lib/utils";

// The speech-bubble tail: a diamond half outside the bubble, in its colours.
const TAIL =
  "after:pointer-events-none after:absolute after:bottom-3 after:size-2.5 after:rotate-45";

const messageBubbleVariants = cva(
  "relative flex w-fit max-w-full flex-col gap-1 rounded-lg px-3 py-2 min-w-0 wrap-anywhere",
  {
    variants: {
      variant: {
        own: `${TAIL} max-w-[85%] bg-primary text-primary-foreground after:-right-1.25 after:bg-primary`,
        // Clipped to its outside half, where overlapping tints would darken.
        human: `${TAIL} bg-primary/10 after:-left-1.25 after:bg-primary/10 after:[clip-path:polygon(0_0,0_100%,100%_100%)]`,
        agent: `${TAIL} bg-message-surface text-message-surface-foreground border border-message-surface-border shadow-sm after:-left-1.25 after:border-b after:border-l after:border-message-surface-border after:bg-message-surface`,
        memory:
          "message-memory bg-accent/35 border border-accent-foreground/15",
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
