import { attributes } from "@tangent/ui-extensions-sdk/contracts/textarea";
import { Textarea } from "@tangent/ui-primitives/textarea";
import type { ChangeEvent } from "react";

import { makeHostComponent } from "../_shared/make-host-component";

export const TextareaHost = makeHostComponent(Textarea, attributes, (props) => {
  const onInput = props.onInput;
  return {
    onChange:
      typeof onInput === "function"
        ? (event: ChangeEvent<HTMLTextAreaElement>) =>
            onInput(event.target.value)
        : undefined,
  };
});
