// local primitive — fixed-width agent roster sidebar with a right border.
// Styles a raw <aside>, so it is exempt from tangle-ui/no-classname-on-primitives.
import type { ComponentProps } from "react";

import { cn } from "@/shared/lib/utils";

export function SidebarColumn({
  children,
  className,
  ...props
}: ComponentProps<"aside">) {
  return (
    <aside
      className={cn(
        "flex w-56 min-h-0 shrink-0 flex-col overflow-hidden border-r",
        className,
      )}
      {...props}
    >
      {children}
    </aside>
  );
}
