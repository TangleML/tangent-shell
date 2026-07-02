import { attributes } from "@tangent/ui-extensions-sdk/contracts/checkbox";
import { Checkbox } from "@tangent/ui-primitives/checkbox";

import { makeHostComponent } from "../_shared/make-host-component";

export const CheckboxHost = makeHostComponent(Checkbox, attributes, (props) => {
  const onChange = props.onChange;
  return {
    onCheckedChange:
      typeof onChange === "function"
        ? (checked: boolean) => onChange(checked)
        : undefined,
  };
});
