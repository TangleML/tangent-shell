import { attributes } from "@tangent/ui-extensions-sdk/contracts/button";
import { Button } from "@tangent/ui-primitives/button";

import { makeHostComponent } from "../_shared/make-host-component";

export const ButtonHost = makeHostComponent(Button, attributes, (props) => {
  const onPress = props.onPress;
  return {
    onClick: typeof onPress === "function" ? () => onPress() : undefined,
  };
});
