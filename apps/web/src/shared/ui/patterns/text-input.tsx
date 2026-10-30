// local primitive — single-line text input. Styles a raw <input>, so it is
// exempt from tangle-ui/no-classname-on-primitives.
import type { ComponentProps } from "react";

import { cn } from "@/shared/lib/utils";

export function TextInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none transition-[color,box-shadow] focus-visible:ring-[3px]",
        className,
      )}
      {...props}
    />
  );
}

TextInput.displayName = "TextInput";
