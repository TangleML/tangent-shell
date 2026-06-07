// local primitive — fixed-width agent roster sidebar with a right border.
// Styles a raw <aside>, so it is exempt from tangle-ui/no-classname-on-primitives.
import type { PropsWithChildren } from "react";

export function SidebarColumn({ children }: PropsWithChildren) {
  return (
    <aside className="flex w-56 min-h-0 shrink-0 flex-col overflow-hidden border-r">
      {children}
    </aside>
  );
}
