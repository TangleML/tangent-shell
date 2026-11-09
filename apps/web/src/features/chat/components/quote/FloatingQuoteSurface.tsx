// local primitive — viewport-anchored, popover-styled surface for the floating
// Quote action. It needs fixed coordinates from the selection, so it styles a
// raw <div> and is exempt from tangle-ui/no-classname-on-primitives.
import type { ReactNode } from "react";

interface FloatingQuoteSurfaceProps {
  top: number;
  left: number;
  children: ReactNode;
}

export function FloatingQuoteSurface({
  top,
  left,
  children,
}: FloatingQuoteSurfaceProps) {
  return (
    <div
      className="bg-popover text-popover-foreground border-border fixed z-50 rounded-md border p-0.5 shadow-md"
      style={{ top, left }}
    >
      {children}
    </div>
  );
}
