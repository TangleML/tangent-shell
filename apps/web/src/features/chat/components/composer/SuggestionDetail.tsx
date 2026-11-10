// local primitive — caps a picker row's secondary text at under half the row,
// so the label keeps most of it. Styles a raw <div>, so it is exempt from
// tangle-ui/no-classname-on-primitives.
import type { ReactNode } from "react";

export function SuggestionDetail({ children }: { children: ReactNode }) {
  return <div className="max-w-[45%] min-w-0 shrink-0">{children}</div>;
}
