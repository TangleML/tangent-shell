import { Badge } from "@tangent/ui-primitives/badge";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./badge.contract";

export const BadgeHost = makeHostComponent(Badge, attributes);
