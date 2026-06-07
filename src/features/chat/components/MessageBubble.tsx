// local primitive — chat message bubble (alignment + tonal background per
// author). Styles a raw <div>, so it is exempt from
// tangle-ui/no-classname-on-primitives.
import { cva, type VariantProps } from "class-variance-authority";
import type { PropsWithChildren } from "react";

import { cn } from "@/shared/lib/utils";

const messageBubbleVariants = cva(
  "flex w-full flex-col gap-1 rounded-lg px-3 py-2 max-w-[85%] min-w-0",
  {
    variants: {
      variant: {
        own: "self-end bg-primary/10 text-foreground",
        human: "self-start bg-muted",
        agent: "self-start bg-muted",
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
}

export function MessageBubble({
  variant,
  className,
  children,
}: MessageBubbleProps) {
  return (
    <div className={cn(messageBubbleVariants({ variant }), className)}>
      {children}
    </div>
  );
}
