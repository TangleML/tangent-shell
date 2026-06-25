import { Textarea } from "@tangent/ui-primitives/textarea";
import type { ChangeEvent } from "react";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./textarea.contract";

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
