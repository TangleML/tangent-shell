// local primitive — scrollable, monospaced error detail block.
// Styles a raw <pre>, so it is exempt from tangle-ui/no-classname-on-primitives.
import type { PropsWithChildren } from "react";

export function ErrorMessage({ children }: PropsWithChildren) {
  return (
    <pre className="max-w-lg overflow-auto rounded-md bg-muted p-4 text-sm text-muted-foreground">
      {children}
    </pre>
  );
}
