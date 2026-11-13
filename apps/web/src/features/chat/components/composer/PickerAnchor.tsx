// local primitive — the box the floating suggestion picker is placed against.
// Styles a raw <div>, so it is exempt from tangle-ui/no-classname-on-primitives.
import type { ReactNode } from "react";

export function PickerAnchor({ children }: { children: ReactNode }) {
  return <div className="relative flex-1">{children}</div>;
}
