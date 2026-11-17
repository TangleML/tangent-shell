import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/utils";

/**
 * StatusDot — Layer 3 semantic primitive.
 *
 * The small coloured dot every list and header uses for a live status, so one
 * status reads the same colour wherever it shows. Decorative: say the status
 * in text nearby, or in a `ListItem` flair's `label`.
 */

const statusDotVariants = cva("size-2 shrink-0 rounded-full", {
  variants: {
    variant: {
      busy: "bg-green-800 animate-pulse animate-very-fast motion-reduce:animate-none",
      active: "bg-green-200",
      away: "bg-warning",
      disconnected: "bg-muted-foreground",
      completed: "bg-muted-foreground",
      killed: "bg-destructive",
      error: "bg-critical",
    },
  },
});

export type StatusDotVariant = NonNullable<
  VariantProps<typeof statusDotVariants>["variant"]
>;

export function StatusDot({ variant }: { variant: StatusDotVariant }) {
  return <span aria-hidden className={cn(statusDotVariants({ variant }))} />;
}
