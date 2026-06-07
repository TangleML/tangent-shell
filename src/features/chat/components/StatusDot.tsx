// local primitive — small connection status indicator dot.
// Styles a raw <span>, so it is exempt from tangle-ui/no-classname-on-primitives.
import { cn } from "@/shared/lib/utils";

export function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        connected ? "bg-green-500" : "bg-muted-foreground",
      )}
    />
  );
}
