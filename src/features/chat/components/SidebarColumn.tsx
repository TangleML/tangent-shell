// local primitive — fixed-width agent roster sidebar with a right border.
// Styles a raw <aside>, so it is exempt from tangle-ui/no-classname-on-primitives.
import type { PropsWithChildren } from "react";

export function SidebarColumn({ children }: PropsWithChildren) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r">{children}</aside>
  );
}
