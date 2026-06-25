import { Icon } from "@tangent/ui-primitives/icon";

import type { RemoteProps } from "../_shared/remote-props";
import { attributes } from "./icon.contract";

// Explicit (not via `makeHostComponent`) because an invalid icon name must render
// nothing rather than spread an undefined `name` into the required `Icon` prop.
export function IconHost(props: RemoteProps) {
  const { name, size, tone } = attributes.safeParse(props).data ?? {};
  if (name == null) return null;
  return <Icon name={name} size={size} tone={tone} />;
}

IconHost.displayName = "Host(Icon)";
