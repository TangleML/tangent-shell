import { Checkbox } from "@/shared/ui/checkbox";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./checkbox.contract";

export const CheckboxHost = makeHostComponent(Checkbox, attributes, (props) => {
  const onChange = props.onChange;
  return {
    onCheckedChange:
      typeof onChange === "function"
        ? (checked: boolean) => onChange(checked)
        : undefined,
  };
});
