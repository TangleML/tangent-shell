// local primitive — small participant-presence indicator dot.
// Styles a raw <span>, so it is exempt from tangle-ui/no-classname-on-primitives.
import type { Presence } from "@tangent/shared/contracts";
import { cva } from "class-variance-authority";

import { cn } from "@/shared/lib/utils";

const presenceDotCva = cva("size-2 shrink-0 rounded-full", {
  variants: {
    presence: {
      connected: "bg-green-500",
      away: "bg-amber-400",
      detached: "bg-muted-foreground",
    } satisfies Record<Presence, string>,
  },
});

export function PresenceDot({ presence }: { presence: Presence }) {
  return <span aria-hidden className={cn(presenceDotCva({ presence }))} />;
}
