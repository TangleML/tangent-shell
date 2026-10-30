import type { ComponentProps } from "react";

import { TextInput } from "@/shared/ui/patterns/text-input";

export function SessionFilterInput(props: ComponentProps<"input">) {
  return <TextInput type="text" {...props} />;
}
