import { Button } from "@tangent/ui-primitives/button";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./button.contract";

export const ButtonHost = makeHostComponent(Button, attributes, (props) => {
  const onPress = props.onPress;
  return {
    onClick: typeof onPress === "function" ? () => onPress() : undefined,
  };
});
